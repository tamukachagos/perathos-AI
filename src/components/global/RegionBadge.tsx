import { getRegionDisplay, REGION_COVERAGE } from "@/integrations/hosting/regionProvisioner";

interface Props {
  region: string;
}

export function RegionBadge({ region }: Props) {
  const display = getRegionDisplay(region);
  const coverage = REGION_COVERAGE[region] ?? "";
  return (
    <div className="region-badge" title={`Serving: ${coverage}`}>
      <span className="region-dot" />
      <span>Hosted in {display}</span>
    </div>
  );
}
