import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CANONICAL_URL } from "@/lib/site";
import {
  getAllPosts,
  getAuthor,
  formatPostDate,
  readingTimeLabel,
} from "@/features/blog";

const description =
  "Practical guides on running a register on the move — payments, offline selling, cash reconciliation, and setup — for food trucks, market stalls, barbers, and small shops.";

export const metadata: Metadata = {
  title: "Blog — Guides for selling on the move",
  description,
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: "VallaPOS Blog — Guides for selling on the move",
    description,
    url: `${CANONICAL_URL}/blog`,
  },
  twitter: { card: "summary", title: "VallaPOS Blog", description },
};

export default async function BlogIndexPage() {
  const posts = getAllPosts();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Blog + ItemList structured data so search engines understand the archive.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${CANONICAL_URL}/blog#blog`,
    name: "VallaPOS Blog",
    description,
    url: `${CANONICAL_URL}/blog`,
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      url: `${CANONICAL_URL}/blog/${post.slug}`,
      datePublished: post.date,
      author: { "@type": "Person", name: getAuthor(post.authorId).name },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto w-full max-w-3xl px-5 py-14">
        <header className="mb-12">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            The VallaPOS Blog
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
            Guides for selling on the move
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Field-tested how-tos and straight talk on payments, offline selling, and running the
            numbers — for food trucks, market stalls, barbers, and one-chair shops.
          </p>
        </header>

        <ul className="flex flex-col divide-y divide-border">
          {posts.map((post) => {
            const author = getAuthor(post.authorId);
            return (
              <li key={post.slug} className="py-8 first:pt-0">
                <article className="group">
                  <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                      {post.category}
                    </span>
                    <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                    <span aria-hidden>·</span>
                    <span>{readingTimeLabel(post)}</span>
                  </div>

                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                    <Link
                      href={`/blog/${post.slug}`}
                      className="transition-colors hover:text-primary"
                    >
                      {post.title}
                    </Link>
                  </h2>

                  <p className="mt-2 text-muted-foreground">{post.description}</p>

                  <div className="mt-4 flex items-center gap-2 text-sm">
                    <span
                      aria-hidden
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                    >
                      {author.initials}
                    </span>
                    <span className="font-medium">{author.name}</span>
                    <span className="text-muted-foreground">· {author.role}</span>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
