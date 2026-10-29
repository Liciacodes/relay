import "server-only";

/**
 * A tool's "menu entry": what the model reads to decide whether to call it.
 * `parameters` is a JSON Schema describing the inputs (the model fills them in).
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** What a tool sends back to the model: small JSON. Either data (with a `count`) or `{ error }`. */
export type ToolResult = Record<string, unknown>;

export interface Tool {
  definition: ToolDefinition;
  /** Runs on our server. `args` come from the model, so check them before using them. */
  run(args: Record<string, unknown>): Promise<ToolResult>;
}
