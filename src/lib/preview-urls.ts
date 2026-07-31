import { defaultUrlTransform } from "react-markdown";

export function transformPreviewUrl(
  url: string,
  attribute: string,
  imageUrls: ReadonlyMap<string, string>,
): string | null | undefined {
  if (attribute === "src") return imageUrls.get(url);
  return defaultUrlTransform(url);
}
