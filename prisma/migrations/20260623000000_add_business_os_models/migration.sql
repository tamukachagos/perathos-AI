-- Migration: add_business_os_models
-- Created: 2026-06-23

-- Booking
CREATE TABLE "Booking" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "siteSlug"      TEXT NOT NULL,
    "customerName"  TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "service"       TEXT NOT NULL,
    "date"          TEXT NOT NULL,
    "time"          TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "notes"         TEXT,
    "whatsappSent"  BOOLEAN NOT NULL DEFAULT false,
    "reminderSent"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Booking_tenantId_idx" ON "Booking"("tenantId");
CREATE INDEX "Booking_siteSlug_idx" ON "Booking"("siteSlug");
CREATE INDEX "Booking_date_idx" ON "Booking"("date");

-- CustomerInvoice
CREATE TABLE "CustomerInvoice" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "number"        TEXT NOT NULL,
    "customerName"  TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "items"         JSONB NOT NULL,
    "subtotalCents" BIGINT NOT NULL,
    "taxCents"      BIGINT NOT NULL DEFAULT 0,
    "totalCents"    BIGINT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'draft',
    "dueDate"       TEXT,
    "pdfUrl"        TEXT,
    "paymentRef"    TEXT,
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerInvoice_tenantId_idx" ON "CustomerInvoice"("tenantId");
CREATE INDEX "CustomerInvoice_status_idx" ON "CustomerInvoice"("status");

-- CrmContact
CREATE TABLE "CrmContact" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "phone"         TEXT,
    "email"         TEXT,
    "source"        TEXT NOT NULL DEFAULT 'manual',
    "stage"         TEXT NOT NULL DEFAULT 'new',
    "notes"         TEXT,
    "tags"          TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastContactAt" TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmContact_tenantId_idx" ON "CrmContact"("tenantId");
CREATE INDEX "CrmContact_stage_idx" ON "CrmContact"("stage");

-- EmailCampaign
CREATE TABLE "EmailCampaign" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "subject"        TEXT NOT NULL,
    "bodyHtml"       TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt"    TIMESTAMP(3),
    "sentAt"         TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "openCount"      INTEGER NOT NULL DEFAULT 0,
    "clickCount"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailCampaign_tenantId_idx" ON "EmailCampaign"("tenantId");
CREATE INDEX "EmailCampaign_status_idx" ON "EmailCampaign"("status");

-- SocialPost
CREATE TABLE "SocialPost" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "content"     TEXT NOT NULL,
    "imageUrl"    TEXT,
    "platforms"   TEXT[] NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "postedAt"    TIMESTAMP(3),
    "status"      TEXT NOT NULL DEFAULT 'draft',
    "externalIds" JSONB,
    "error"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocialPost_tenantId_idx" ON "SocialPost"("tenantId");
CREATE INDEX "SocialPost_status_idx" ON "SocialPost"("status");
CREATE INDEX "SocialPost_scheduledAt_idx" ON "SocialPost"("scheduledAt");

-- BrandKit
CREATE TABLE "BrandKit" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "logoUrl"        TEXT,
    "logoPrompt"     TEXT,
    "primaryColor"   TEXT,
    "secondaryColor" TEXT,
    "accentColor"    TEXT,
    "fontFamily"     TEXT,
    "tagline"        TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandKit_tenantId_key" ON "BrandKit"("tenantId");

-- ReviewRecord
CREATE TABLE "ReviewRecord" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "source"      TEXT NOT NULL,
    "rating"      INTEGER NOT NULL,
    "text"        TEXT NOT NULL,
    "authorName"  TEXT NOT NULL,
    "authorPhoto" TEXT,
    "response"    TEXT,
    "respondedAt" TIMESTAMP(3),
    "externalId"  TEXT,
    "publishedAt" TIMESTAMP(3),
    "featured"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReviewRecord_tenantId_idx" ON "ReviewRecord"("tenantId");
CREATE INDEX "ReviewRecord_rating_idx" ON "ReviewRecord"("rating");

-- MarketingRun
CREATE TABLE "MarketingRun" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT,
    "agentType"  TEXT NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'running',
    "result"     JSONB,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"    TIMESTAMP(3),

    CONSTRAINT "MarketingRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingRun_tenantId_idx" ON "MarketingRun"("tenantId");
CREATE INDEX "MarketingRun_agentType_idx" ON "MarketingRun"("agentType");
CREATE INDEX "MarketingRun_startedAt_idx" ON "MarketingRun"("startedAt");

-- SitePage
CREATE TABLE "SitePage" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "siteSlug"  TEXT NOT NULL,
    "path"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "metaDesc"  TEXT,
    "blocks"    JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SitePage_siteSlug_path_key" ON "SitePage"("siteSlug", "path");
CREATE INDEX "SitePage_tenantId_idx" ON "SitePage"("tenantId");
CREATE INDEX "SitePage_siteSlug_idx" ON "SitePage"("siteSlug");
