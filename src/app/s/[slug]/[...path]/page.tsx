// Catch-all route for additional pages on a business site.
//
//   /s/salon-cape-town/about        → shows the "About" SitePage
//   /s/salon-cape-town/blog/our-story → shows a blog post SitePage
//
// Server component. Fetches the SitePage record from DB by (siteSlug, path).
// If no record is found, renders a 404 panel inside the site's header/footer.
// If found, renders the blocks JSON using the block-type renderer below.
// The business header and footer mirror PublishedSiteView so the branding is
// consistent across every sub-page.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

interface HeadingBlock {
  type: "heading";
  text: string;
  level: 1 | 2 | 3;
}

interface ParagraphBlock {
  type: "paragraph";
  text: string;
}

interface ImageBlock {
  type: "image";
  url: string;
  alt: string;
  caption?: string;
}

interface CtaBlock {
  type: "cta";
  heading: string;
  subtext: string;
  buttonText: string;
  buttonHref: string;
}

interface ServiceItem {
  name: string;
  description: string;
  price?: string;
}

interface ServicesBlock {
  type: "services";
  items: ServiceItem[];
}

interface GalleryImage {
  url: string;
  alt: string;
}

interface GalleryBlock {
  type: "gallery";
  images: GalleryImage[];
}

interface DividerBlock {
  type: "divider";
}

type Block =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | CtaBlock
  | ServicesBlock
  | GalleryBlock
  | DividerBlock;

// ---------------------------------------------------------------------------
// SitePage record (subset of Prisma model fields used here)
// ---------------------------------------------------------------------------

interface SitePageRecord {
  id: string;
  tenantId: string;
  siteSlug: string;
  path: string;
  title: string;
  metaDesc: string | null;
  blocks: unknown; // JSON from DB — typed as unknown, cast safely below
  published: boolean;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

// Fetch all published pages for a site (for the site nav).
async function resolvePageNav(siteSlug: string): Promise<{ title: string; path: string }[]> {
  try {
    const { prisma } = await import("@/lib/db/prisma/client");
    const pages = await prisma.sitePage.findMany({
      where: { siteSlug, published: true },
      select: { title: true, path: true },
      orderBy: { createdAt: "asc" },
    });
    return pages;
  } catch {
    return [];
  }
}

// Fetch a single SitePage by (siteSlug, path). Returns null if not found or not published.
async function resolvePage(siteSlug: string, path: string): Promise<SitePageRecord | null> {
  try {
    const { prisma } = await import("@/lib/db/prisma/client");
    const page = await prisma.sitePage.findUnique({
      where: { siteSlug_path: { siteSlug, path } },
    });
    if (!page || !page.published) return null;
    return page as SitePageRecord;
  } catch {
    return null;
  }
}

// Resolve the site name/slug from GeneratedSite so we can display the business name.
async function resolveSiteName(siteSlug: string): Promise<string | null> {
  try {
    const { prisma } = await import("@/lib/db/prisma/client");
    const site = await prisma.generatedSite.findFirst({
      where: { slug: siteSlug, status: "published" },
      include: { business: { select: { name: true } } },
    });
    return site?.business?.name ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Block renderer
// ---------------------------------------------------------------------------

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${block.level}`) as "h1" | "h2" | "h3";
      const cls =
        block.level === 1
          ? "public-block-heading1"
          : block.level === 2
          ? "public-block-heading2"
          : "public-block-heading3";
      return <Tag key={index} className={cls}>{block.text}</Tag>;
    }

    case "paragraph":
      return (
        <p key={index} className="public-block-paragraph">
          {block.text}
        </p>
      );

    case "image":
      return (
        <figure key={index} style={{ margin: "16px 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="public-block-image"
            src={block.url}
            alt={block.alt}
          />
          {block.caption ? (
            <figcaption
              style={{
                fontSize: 13,
                color: "var(--muted)",
                textAlign: "center",
                marginTop: 6,
              }}
            >
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );

    case "cta":
      return (
        <div key={index} className="public-block-cta">
          <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, color: "#fff" }}>
            {block.heading}
          </h2>
          <p style={{ margin: "0 0 20px", opacity: 0.9 }}>{block.subtext}</p>
          <a
            href={block.buttonHref}
            className="public-secondary"
            style={{ display: "inline-flex", background: "#fff", color: "var(--accent, #6366f1)" }}
          >
            {block.buttonText}
          </a>
        </div>
      );

    case "services":
      return (
        <div key={index} className="public-service-grid" style={{ marginBottom: 24 }}>
          {block.items.map((item, i) => (
            <article key={i}>
              <strong>{item.name}</strong>
              {item.price ? (
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    color: "var(--green)",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {item.price}
                </span>
              ) : null}
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      );

    case "gallery":
      return (
        <div key={index} className="public-block-gallery">
          {block.images.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={img.url} alt={img.alt} />
          ))}
        </div>
      );

    case "divider":
      return (
        <hr
          key={index}
          style={{ border: 0, borderTop: "1px solid var(--border)", margin: "24px 0" }}
        />
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page props
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ slug: string; path: string[] }>;
}

export const dynamicParams = true;
export const revalidate = 60;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, path: pathSegments } = await params;
  const path = "/" + pathSegments.join("/");
  const page = await resolvePage(slug, path);
  if (!page) return { title: "Page not found" };
  return {
    title: page.title,
    description: page.metaDesc ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function SiteSubPage({ params }: PageProps) {
  const { slug, path: pathSegments } = await params;
  const pagePath = "/" + pathSegments.join("/");

  // Fetch page and nav in parallel.
  const [page, navPages, siteName] = await Promise.all([
    resolvePage(slug, pagePath),
    resolvePageNav(slug),
    resolveSiteName(slug),
  ]);

  const displayName = siteName ?? slug;

  // Normalise blocks array safely from the JSON column.
  const blocks: Block[] = Array.isArray(page?.blocks) ? (page.blocks as Block[]) : [];

  return (
    <main className="published-shell">
      {/* Header — mirrors PublishedSiteView header */}
      <header className="published-header">
        <Link className="ghost-button back-button" href={`/s/${slug}`}>
          <ArrowLeft size={16} />
          {displayName}
        </Link>
        <nav aria-label="Site pages">
          <Link
            className="anchor-link"
            href={`/s/${slug}`}
            style={{ marginRight: 4 }}
          >
            Home
          </Link>
          {navPages.map((p) => (
            <Link
              key={p.path}
              className="anchor-link"
              href={`/s/${slug}${p.path}`}
              style={{ marginRight: 4 }}
              aria-current={p.path === pagePath ? "page" : undefined}
            >
              {p.title}
            </Link>
          ))}
        </nav>
      </header>

      {/* Page content */}
      {page ? (
        <article className="public-page">
          <h1
            className="public-block-heading1"
            style={{ marginTop: 0, marginBottom: 24 }}
          >
            {page.title}
          </h1>
          {blocks.map((block, i) => renderBlock(block, i))}
        </article>
      ) : (
        /* 404 within the business site layout */
        <section
          className="missing-site-panel"
          style={{ marginTop: 24, maxWidth: 760, margin: "24px auto" }}
        >
          <h1>Page not found</h1>
          <p>
            This page has not been published yet. Return to the{" "}
            <Link href={`/s/${slug}`} style={{ color: "var(--blue)", fontWeight: 700 }}>
              {displayName} home page
            </Link>
            .
          </p>
        </section>
      )}

      {/* Footer */}
      <footer className="published-footer">
        <span>{displayName}</span>
        <div className="published-footer-meta">
          <Link className="anchor-link" href="/privacy">
            Privacy &amp; POPIA
          </Link>
        </div>
      </footer>
    </main>
  );
}
