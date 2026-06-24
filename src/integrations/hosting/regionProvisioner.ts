"use server";
import { COUNTRY_REGION } from "@/lib/global/config";

export const REGION_CLUSTER: Record<string, { cluster: string; endpoint: string; provider: string }> = {
  "us-east":      { cluster: "ld-us-east-1",    endpoint: "k8s.us-east.perathos.com",   provider: "eks" },
  "us-west":      { cluster: "ld-us-west-1",    endpoint: "k8s.us-west.perathos.com",   provider: "eks" },
  "eu-west":      { cluster: "ld-eu-west-1",    endpoint: "k8s.eu-west.perathos.com",   provider: "gke" },
  "eu-central":   { cluster: "ld-eu-central-1", endpoint: "k8s.eu-central.perathos.com",provider: "gke" },
  "ap-southeast": { cluster: "ld-ap-se-1",      endpoint: "k8s.ap-se.perathos.com",     provider: "aks" },
  "ap-northeast": { cluster: "ld-ap-ne-1",      endpoint: "k8s.ap-ne.perathos.com",     provider: "aks" },
  "af-south":     { cluster: "ld-af-south-1",   endpoint: "k8s.af.perathos.com",        provider: "gke" },
};

export const REGION_DISPLAY: Record<string, string> = {
  "us-east":      "United States (East)",
  "us-west":      "United States (West)",
  "eu-west":      "Europe (West)",
  "eu-central":   "Europe (Central)",
  "ap-southeast": "Asia Pacific (SE)",
  "ap-northeast": "Asia Pacific (NE)",
  "af-south":     "Africa (South)",
};

export const REGION_COVERAGE: Record<string, string> = {
  "us-east":      "North & South America",
  "us-west":      "North America, Pacific",
  "eu-west":      "Western Europe, UK",
  "eu-central":   "Central Europe, Middle East",
  "ap-southeast": "Southeast Asia, Australia",
  "ap-northeast": "Japan, Korea, China",
  "af-south":     "Africa",
};

export function selectRegion(countryCode: string, preferred?: string): string {
  if (preferred) return preferred;
  return COUNTRY_REGION[countryCode] ?? "us-east";
}

export function getCdnEndpoint(slug: string, region: string): string {
  const sub: Record<string, string> = {
    "us-east": "us", "us-west": "us",
    "eu-west": "eu", "eu-central": "eu",
    "ap-southeast": "ap", "ap-northeast": "ap",
    "af-south": "af",
  };
  return `${slug}.${sub[region] ?? "us"}.perathos.com`;
}

export function getRegionDisplay(region: string): string {
  return REGION_DISPLAY[region] ?? region;
}
