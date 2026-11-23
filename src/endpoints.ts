/** Public calculator.aws data endpoints. Unversioned; treat as a dependency. */
export const LOCALE = "en_US";
export const CURRENCY = "USD";

export const ENDPOINTS = {
  catalog: `https://d1qsjq9pzbk1k6.cloudfront.net/manifest/${LOCALE}.json`,
  regionList: "https://d1qsjq9pzbk1k6.cloudfront.net/manifest/regionList/publish.json",
  definitionBase: "https://d1qsjq9pzbk1k6.cloudfront.net",
  locations: "https://b0.p.awsstatic.com/locations/1.0/aws/current/locations.json",
  runtimeConfig: "https://calculator.aws/FrontEndUI/prod-us-east-1.json",
  pricingBase: "https://calculator.aws",
  publish: "https://dnd5zrqcec4or.cloudfront.net/Prod/v2/saveAs",
  retrieve: "https://d3knqfixx3sbls.cloudfront.net",
} as const;

export function definitionUrl(serviceCode: string, locale = LOCALE): string {
  return `${ENDPOINTS.definitionBase}/data/${serviceCode}/${locale}.json`;
}

export function pricingUrl(path: string, currency = CURRENCY): string {
  const hydrated = path.replace("[currency]", currency);
  if (/^https?:\/\//.test(hydrated)) return hydrated;
  return `${ENDPOINTS.pricingBase}/${hydrated.replace(/^\/+/, "")}`;
}

export function publicEstimateUrl(savedKey: string): string {
  return `https://calculator.aws/#/estimate?id=${savedKey}`;
}

export function savedKeyFromUrl(url: string): string | undefined {
  const match = /[?&#]id=([^&\s]+)/.exec(url);
  return match?.[1];
}
