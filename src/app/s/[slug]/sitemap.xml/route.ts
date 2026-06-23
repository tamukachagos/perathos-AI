// Dynamic sitemap for a published business site at /s/[slug]/sitemap.xml
// Also pinged by SeoAgent after generation. Public route — no auth required.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
) {
  const { slug } = params;

  // Resolve site
  const site = await prisma.generatedSite.findFirst({
    where: { slug, status: "published" },
    include: { business: { select: { domainName: true, tenantId: true } } },
  });

  if (!site) {
    return new NextResponse("Not found", { status: 404 });
  }

  const baseUrl = site.business?.domainName
    ? `https://${site.business.domainName}`
    : `https://app.perathos.com/s/${slug}`;

  // Published pages
  const pages = await prisma.sitePage.findMany({
    where: { siteSlug: slug, published: true },
    select: { path: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const today = new Date().toISOString().slice(0, 10);

  const urls = [
    // Root page
    `  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`,
    // Additional pages
    ...pages.map(
      (p) => `  <url>
    <loc>${baseUrl}${p.path}</loc>
    <lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
    ),
  ].join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
