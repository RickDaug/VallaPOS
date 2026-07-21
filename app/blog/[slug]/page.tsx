import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CANONICAL_URL } from "@/lib/site";
import {
  getPost,
  getAllSlugs,
  getAuthor,
  renderMarkdown,
  formatPostDate,
  readingTimeLabel,
} from "@/features/blog";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const author = getAuthor(post.authorId);
  const url = `${CANONICAL_URL}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    authors: [{ name: author.name }],
    keywords: post.tags,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.date,
      authors: [author.name],
      tags: post.tags,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const author = getAuthor(post.authorId);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url: `${CANONICAL_URL}/blog/${post.slug}`,
    datePublished: post.date,
    dateModified: post.date,
    keywords: post.tags.join(", "),
    author: { "@type": "Person", name: author.name },
    publisher: {
      "@type": "Organization",
      name: "VallaPOS",
      url: `${CANONICAL_URL}/`,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${CANONICAL_URL}/blog/${post.slug}` },
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="mx-auto w-full max-w-2xl px-5 py-12">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden />
          All posts
        </Link>

        <header className="mt-6">
          <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
              {post.category}
            </span>
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{readingTimeLabel(post)}</span>
          </div>

          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{post.description}</p>

          <div className="mt-6 flex items-center gap-3 border-y border-border py-4">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
            >
              {author.initials}
            </span>
            <div className="text-sm">
              <div className="font-semibold">{author.name}</div>
              <div className="text-muted-foreground">{author.role}</div>
            </div>
          </div>
        </header>

        <div className="blog-prose mt-8">{renderMarkdown(post.body)}</div>

        <aside className="mt-12 rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary"
            >
              {author.initials}
            </span>
            <div>
              <div className="text-sm font-semibold">
                Written by {author.name}
                <span className="ml-2 font-normal text-muted-foreground">{author.role}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{author.bio}</p>
            </div>
          </div>
        </aside>

        <div className="mt-10 rounded-xl border border-border bg-secondary/50 p-6 text-center">
          <h2 className="text-lg font-semibold">Run your register anywhere</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Cash and QR ready, works with no signal, and never takes a cut of your sales. Set it
            up on the phone you already own.
          </p>
          <Link
            href="/sign-up"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </article>
    </>
  );
}
