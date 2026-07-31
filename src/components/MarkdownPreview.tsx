"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { transformPreviewUrl } from "@/src/lib/preview-urls";

interface MarkdownPreviewProps {
  markdown: string;
  imageUrls: Map<string, string>;
}

export default function MarkdownPreview({
  markdown,
  imageUrls,
}: MarkdownPreviewProps) {
  return (
    <article className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url, attribute) =>
          transformPreviewUrl(url, attribute, imageUrls)
        }
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
