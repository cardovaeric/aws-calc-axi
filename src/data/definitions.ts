import { fetchCachedJson, type CacheOptions } from "../cache.ts";
import { definitionUrl } from "../endpoints.ts";

/** A component is declarative: type + subType decide how the engine reads it. */
export interface Component {
  type: string;
  subType?: string;
  id: string;
  [key: string]: unknown;
}

export interface Card {
  title?: string;
  cardType?: string;
  repeatable?: boolean;
  displayIf?: unknown;
  inputSection?: { components?: Component[] };
  mathsSection?: Array<{ components?: Component[] }>;
  [key: string]: unknown;
}

export interface Template {
  title?: string;
  id: string;
  description?: string;
  helpUrl?: string;
  cards?: Card[];
  [key: string]: unknown;
}

export interface MappingDefinition {
  mappingDefinitionName: string;
  mappingDefinitionURL: string;
  includeRegions?: boolean;
}

export interface ServiceDefinition {
  version: string;
  serviceName: string;
  serviceCode: string;
  type?: string;
  subType?: string;
  slug?: string;
  layout?: string;
  regions?: string[];
  costType?: string[];
  mappingDefinitions?: MappingDefinition[];
  templates?: Template[];
  defaultTemplates?: string[];
  templateId?: string;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

export type DefinitionsIndex = Record<string, ServiceDefinition>;

const memo = new Map<string, ServiceDefinition>();

/** Load and memoize one service definition. */
export async function loadDefinition(
  serviceCode: string,
  options: CacheOptions = {}
): Promise<ServiceDefinition> {
  const cached = memo.get(serviceCode);
  if (cached) return cached;
  const definition = await fetchCachedJson<ServiceDefinition>(
    definitionUrl(serviceCode),
    options
  );
  if (!definition || typeof definition.serviceCode !== "string") {
    throw new Error(`definition for ${serviceCode} is missing serviceCode`);
  }
  memo.set(serviceCode, definition);
  return definition;
}

export function clearDefinitionMemo(): void {
  memo.clear();
}

export function templateById(
  definition: ServiceDefinition,
  templateId: string | undefined
): Template | undefined {
  const templates = definition.templates ?? [];
  if (!templateId) return templates[0];
  return templates.find((template) => template.id === templateId);
}

/** All components of a template in evaluation order (inputs then maths, card by card). */
export function templateComponents(template: Template): {
  cards: Array<{ card: Card; inputs: Component[]; maths: Component[] }>;
} {
  const cards = (template.cards ?? []).map((card) => {
    const inputs = card.inputSection?.components ?? [];
    const maths = (card.mathsSection ?? []).flatMap((section) => section.components ?? []);
    return { card, inputs, maths };
  });
  return { cards };
}

export function isSelector(definition: ServiceDefinition): boolean {
  return definition.subType === "subServiceSelector" || definition.layout === "loader";
}
