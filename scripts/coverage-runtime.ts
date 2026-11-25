/**
 * Runtime verdicts for the coverage tracker's `--evaluate` pass.
 *
 * The label has to distinguish three different things that all used to read
 * `error`: the engine declining for a known reason, the engine finding no price
 * for a meter (`MissingPriceError`, which is not an `EngineError`), and this
 * machine not having the data cached. Only the middle one is a coverage gap,
 * and the last one is not a property of the service at all.
 */
import { EngineError } from "../src/engine/errors.ts";

export function runtimeLabel(error: unknown): string {
  if (error instanceof EngineError) {
    switch (error.code) {
      case "MISSING_INPUT":
        return "needs-input";
      case "MISSING_PRICE":
        return "missing-price";
      case "AMBIGUOUS_SELECTION":
        return "ambiguous";
      case "UNSUPPORTED_COMPONENT":
      case "UNSUPPORTED_INPUT":
        return "unsupported";
      case "UNKNOWN_REGION":
        return "unknown-region";
      case "BAD_DEFINITION":
        return "bad-definition";
      default:
        return "error";
    }
  }
  if ((error as Error | undefined)?.name === "MissingPriceError") return "missing-price";
  if (/offline and no cached copy of /.test(String((error as Error | undefined)?.message))) {
    return "not-cached";
  }
  return "error";
}
