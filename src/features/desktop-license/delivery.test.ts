import { describe, expect, it } from "vitest";
import { renderLicenseEmail } from "./email";

describe("renderLicenseEmail", () => {
  it("includes the license key + download link in both text and html", () => {
    const email = renderLicenseEmail({
      licenseKey: "VLK1ABCDEF",
      downloadUrl: "https://github.com/RickDaug/VallaPOS/releases",
    });
    expect(email.subject).toMatch(/license/i);
    expect(email.text).toContain("VLK1ABCDEF");
    expect(email.text).toContain("https://github.com/RickDaug/VallaPOS/releases");
    expect(email.html).toContain("VLK1ABCDEF");
    expect(email.html).toContain('href="https://github.com/RickDaug/VallaPOS/releases"');
  });

  it("HTML-escapes the key so a crafted blob can't inject markup", () => {
    const email = renderLicenseEmail({ licenseKey: "<script>x</script>", downloadUrl: "https://x/y" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
