"use server";

// Reviews adapter — Google Reviews import and manual testimonial management.
// Manual reviews always work (no key needed). Google import requires
// GOOGLE_REVIEWS_API_KEY but the adapter reports isConfigured() = true either way.
// Review records are stored in the ReviewRecord Prisma model.

import { prisma } from "@/lib/prisma";

const GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/details/json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewData {
  source: string;
  rating: number;
  text: string;
  authorName: string;
  authorPhoto?: string;
  externalId?: string;
  publishedAt?: Date;
  featured?: boolean;
}

export interface ReviewRecord {
  id: string;
  tenantId: string;
  source: string;
  rating: number;
  text: string;
  authorName: string;
  authorPhoto?: string | null;
  response?: string | null;
  respondedAt?: Date | null;
  externalId?: string | null;
  publishedAt?: Date | null;
  featured: boolean;
  createdAt: Date;
}

export interface ReviewsProvider {
  fetchGoogleReviews(placeId: string): Promise<ReviewData[]>;
  saveReview(tenantId: string, data: ReviewData): Promise<ReviewRecord>;
  listReviews(tenantId: string): Promise<ReviewRecord[]>;
  respondToReview(id: string, response: string): Promise<ReviewRecord>;
  getFeaturedReviews(tenantId: string): Promise<ReviewRecord[]>;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): ReviewsProvider {
  const store = new Map<string, ReviewRecord>();

  return {
    async fetchGoogleReviews(placeId) {
      console.log(`[mock:reviews] fetchGoogleReviews placeId=${placeId}`);
      return [
        {
          source: "google",
          rating: 5,
          text: "Excellent service!",
          authorName: "Happy Customer",
          externalId: `mock-google-${placeId}-1`,
          publishedAt: new Date(),
        },
        {
          source: "google",
          rating: 4,
          text: "Very good, will return.",
          authorName: "Returning Client",
          externalId: `mock-google-${placeId}-2`,
          publishedAt: new Date(),
        },
      ];
    },

    async saveReview(tenantId, data) {
      const record: ReviewRecord = {
        id: `mock-review-${Date.now()}`,
        tenantId,
        source: data.source,
        rating: data.rating,
        text: data.text,
        authorName: data.authorName,
        authorPhoto: data.authorPhoto ?? null,
        response: null,
        respondedAt: null,
        externalId: data.externalId ?? null,
        publishedAt: data.publishedAt ?? null,
        featured: data.featured ?? false,
        createdAt: new Date(),
      };
      store.set(record.id, record);
      console.log("[mock:reviews] saveReview", record.id);
      return record;
    },

    async listReviews(tenantId) {
      return Array.from(store.values()).filter((r) => r.tenantId === tenantId);
    },

    async respondToReview(id, response) {
      const existing = store.get(id);
      if (!existing) throw new Error(`[mock:reviews] Review ${id} not found`);
      const updated = { ...existing, response, respondedAt: new Date() };
      store.set(id, updated);
      return updated;
    },

    async getFeaturedReviews(tenantId) {
      return Array.from(store.values()).filter(
        (r) => r.tenantId === tenantId && r.featured,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter — Google Places API + Prisma ReviewRecord
// ---------------------------------------------------------------------------

interface GooglePlacesReview {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  text: string;
  time: number;
}

interface GooglePlacesResponse {
  result?: {
    reviews?: GooglePlacesReview[];
  };
  status: string;
}

export function createRealAdapter(): ReviewsProvider {
  const googleKey = process.env.GOOGLE_REVIEWS_API_KEY;

  return {
    async fetchGoogleReviews(placeId) {
      if (!googleKey) {
        console.warn("[reviews] GOOGLE_REVIEWS_API_KEY not set — returning empty list");
        return [];
      }

      const url = new URL(GOOGLE_PLACES_URL);
      url.searchParams.set("place_id", placeId);
      url.searchParams.set("fields", "reviews");
      url.searchParams.set("key", googleKey);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Google Places API error ${res.status}`);

      const json = (await res.json()) as GooglePlacesResponse;
      const raw = json.result?.reviews ?? [];

      return raw.map((r) => ({
        source: "google",
        rating: r.rating,
        text: r.text,
        authorName: r.author_name,
        authorPhoto: r.profile_photo_url,
        publishedAt: new Date(r.time * 1000),
      }));
    },

    async saveReview(tenantId, data) {
      return prisma.reviewRecord.create({
        data: {
          tenantId,
          source: data.source,
          rating: data.rating,
          text: data.text,
          authorName: data.authorName,
          authorPhoto: data.authorPhoto,
          externalId: data.externalId,
          publishedAt: data.publishedAt,
          featured: data.featured ?? false,
        },
      }) as unknown as ReviewRecord;
    },

    async listReviews(tenantId) {
      return prisma.reviewRecord.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }) as unknown as ReviewRecord[];
    },

    async respondToReview(id, response) {
      return prisma.reviewRecord.update({
        where: { id },
        data: { response, respondedAt: new Date() },
      }) as unknown as ReviewRecord;
    },

    async getFeaturedReviews(tenantId) {
      return prisma.reviewRecord.findMany({
        where: { tenantId, featured: true },
        orderBy: { rating: "desc" },
      }) as unknown as ReviewRecord[];
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness + public surface
// ---------------------------------------------------------------------------

/**
 * Always true — manual reviews work without any key.
 * Google import additionally requires GOOGLE_REVIEWS_API_KEY.
 */
export function isConfigured(): boolean {
  return true;
}

export function getProvider(): ReviewsProvider {
  if (process.env.DATABASE_URL) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
