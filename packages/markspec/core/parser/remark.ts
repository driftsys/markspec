/**
 * @module parser/remark
 *
 * Shared remark processor instance for Markdown parsing.
 * Used by both the entry parser and the caption detector.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/** Shared remark + GFM processor. Built once, reused across modules. */
export const processor = unified().use(remarkParse).use(remarkGfm);
