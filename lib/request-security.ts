export class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export function isSameOriginMutation(
  request: Request,
  requestOrigin: string,
  canonicalOrigin?: string,
): boolean {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return false;

  try {
    const sourceOrigin = new URL(source).origin;
    if (process.env.NODE_ENV === "production") {
      return sourceOrigin === (canonicalOrigin ?? requestOrigin);
    }
    return (
      sourceOrigin === requestOrigin ||
      (canonicalOrigin !== undefined && sourceOrigin === canonicalOrigin)
    );
  } catch {
    return false;
  }
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError(413, "The uploaded file is too large.");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RequestBodyError(413, "The uploaded file is too large.");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
