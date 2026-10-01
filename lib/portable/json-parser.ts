export const MAX_PORTABLE_JSON_BYTES = 10 * 1024 * 1024;
export const MAX_PORTABLE_JSON_DEPTH = 20;

export class StrictJsonError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "StrictJsonError";
  }
}

export function parseStrictJsonBytes(
  bytes: Uint8Array,
  options: { maxBytes?: number; maxDepth?: number } = {},
): unknown {
  const maxBytes = options.maxBytes ?? MAX_PORTABLE_JSON_BYTES;
  if (bytes.byteLength > maxBytes) {
    throw new StrictJsonError(
      `The file is larger than the ${formatBytes(maxBytes)} limit.`,
      "$",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError("The file is not valid UTF-8.", "$");
  }

  return parseStrictJson(text, { ...options, maxBytes });
}

export function parseStrictJson(
  text: string,
  options: { maxBytes?: number; maxDepth?: number } = {},
): unknown {
  const maxBytes = options.maxBytes ?? MAX_PORTABLE_JSON_BYTES;
  const maxDepth = options.maxDepth ?? MAX_PORTABLE_JSON_DEPTH;
  const size = new TextEncoder().encode(text).byteLength;

  if (size > maxBytes) {
    throw new StrictJsonError(
      `The file is larger than the ${formatBytes(maxBytes)} limit.`,
      "$",
    );
  }

  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string, path: string): never => {
    throw new StrictJsonError(`${message} (character ${index + 1}).`, path);
  };

  const skipWhitespace = () => {
    while (
      index < text.length &&
      (text[index] === " " ||
        text[index] === "\n" ||
        text[index] === "\r" ||
        text[index] === "\t")
    ) {
      index += 1;
    }
  };

  const readString = (path: string): string => {
    if (text[index] !== '"') fail("Expected a JSON string", path);
    const start = index;
    index += 1;

    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          fail("Invalid JSON string", path);
        }
      }

      if (character === "\\") {
        index += 1;
        const escaped = text[index];
        if (!escaped || !'"\\/bfnrtu'.includes(escaped)) {
          fail("Invalid JSON escape", path);
        }
        if (escaped === "u") {
          const hex = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            fail("Invalid Unicode escape", path);
          }
          index += 4;
        }
      } else if (character.charCodeAt(0) < 0x20) {
        fail("Unescaped control character in JSON string", path);
      }

      index += 1;
    }

    return fail("Unterminated JSON string", path);
  };

  const readLiteralOrNumber = (path: string) => {
    const rest = text.slice(index);
    const literal = /^(?:true|false|null)/.exec(rest)?.[0];
    if (literal) {
      index += literal.length;
      return;
    }

    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest)?.[0];
    if (!number) return fail("Expected a JSON value", path);
    index += number.length;
  };

  const readValue = (depth: number, path: string): void => {
    if (depth > maxDepth) {
      fail(`JSON nesting exceeds the limit of ${maxDepth}`, path);
    }

    skipWhitespace();
    const character = text[index];

    if (character === '"') {
      readString(path);
      return;
    }

    if (character === "[") {
      index += 1;
      skipWhitespace();
      let itemIndex = 0;
      if (text[index] === "]") {
        index += 1;
        return;
      }

      while (index < text.length) {
        readValue(depth + 1, `${path}[${itemIndex}]`);
        itemIndex += 1;
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index] !== ",") fail("Expected ',' or ']'", path);
        index += 1;
        skipWhitespace();
      }
      fail("Unterminated JSON array", path);
    }

    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return;
      }

      while (index < text.length) {
        const key = readString(path);
        const keyPath = `${path}[${JSON.stringify(key)}]`;
        if (keys.has(key)) {
          throw new StrictJsonError(`Duplicate object key ${JSON.stringify(key)}.`, keyPath);
        }
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") fail("Expected ':' after object key", keyPath);
        index += 1;
        readValue(depth + 1, keyPath);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index] !== ",") fail("Expected ',' or '}'", path);
        index += 1;
        skipWhitespace();
      }
      fail("Unterminated JSON object", path);
    }

    readLiteralOrNumber(path);
  };

  skipWhitespace();
  readValue(1, "$");
  skipWhitespace();
  if (index !== text.length) fail("Unexpected content after the JSON value", "$");

  try {
    return JSON.parse(text.slice(text.charCodeAt(0) === 0xfeff ? 1 : 0)) as unknown;
  } catch {
    throw new StrictJsonError("The file is not valid JSON.", "$");
  }
}

function formatBytes(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes)
    ? `${mebibytes} MiB`
    : `${Math.round(bytes / 1024)} KiB`;
}
