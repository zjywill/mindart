---
name: mindart
description: Open and operate the MindArt image genealogy canvas. Use when the user says /mindart, asks to open a MindArt board or image canvas, wants to organize reference images on an image lineage canvas, sends a compiled MindArt generation request that must be generated and applied back to a card, or asks where MindArt came from and how to update it.
---

# MindArt

## Open The Canvas

1. Resolve the user's active project or workspace directory as an absolute path.
2. Call `mindart_open_canvas` with `project_dir` set to that path. Pass `board_id` only when the user named an existing board.
3. Do not expose or ask the user to call internal canvas tools. Importing, editing, linking, and queueing happen in the widget.

## Keep The Board A Genealogy

A MindArt board is a free canvas where every card records where its image came
from, and the canvas draws those records as lineage lines. One rule decides
every connection:

**A card's sources are the images you actually fed to the generator.**

Not what the result resembles, and not what it is about — what went in. Each
image you fed becomes a numbered reference on the card, in the order you passed
it, each with a note saying what you took from it. Reference 1 is the primary
source — pass it as `parent_node_id`.

Import a generated image like this:

```
mindart_import_image(
  board_id, source_path, title,
  parent_node_id = <the card whose image you primarily built on>,
  sources = [{ node_id, usage }, ...],   # every card you fed, in generator order
  prompt = <the instruction you used>
)
```

Call `mindart_get_board` first whenever you do not already know the node ids.
Never guess one. If a source image is not on the board yet, import it first —
with no sources, because the user supplied it — and use the node id it returns.

`mindart_import_image` reports the sources it recorded. If it says none were
recorded and the image was in fact derived from cards on the board, fix it with
`mindart_link_sources` before replying.

## Choosing The Connection

| What you generated | `parent_node_id` | `sources` |
|---|---|---|
| Nothing — the user supplied the file | omit | omit |
| From text only, no image fed in | omit | omit |
| An edit of one card's image | that card | that card |
| An edit of one card, guided by another | the card you edited | the edited card first, then the guide |
| A combination of several cards | the card supplying the subject | every card you fed, in order |
| A crop, upscale, background removal, or aspect change | the card it came from | that card |
| Another attempt after the user rejected a result | the rejected card's **primary source** | the rejected card's sources |
| Several variants in one go | the same primary source for every variant | the same sources for every variant |

When several images went in and the primary source is not obvious, it is the one
supplying the subject — the character, object, or scene that carries forward.
Style, palette, composition, and lighting references are never primary. If
two images both supply subject, pick the one that occupies more of the result,
and failing that the one the user named first.

Editing is how a lineage grows: each accepted change references the image it was
made from, so the chain reads as that image's edit history. Two shapes are easy
to get wrong:

- **Variants share one source, they are not a chain.** Four options from one
  prompt all reference the same source. Chaining them claims each was generated
  from the last.
- **A retry references what the rejected card referenced, not the rejected
  card.** You fed the rejected card's inputs again, not the rejected card
  itself. Linking the retry to the rejection records a derivation that never
  happened.

Do not create a card for a generation that failed.

## Write Down What Each Source Contributed

The `usage` note on a source is what the connection means, and the canvas
replays it when the user regenerates the card. Say what you took, in the user's
language:

```
sources = [
  { node_id: "node-298170d2-1", usage: "保留头部特征、五官与配色" },
  { node_id: "node-5bf9de1b-1", usage: "沿用绿色圆角方形 icon 的构图与质感" },
]
```

An empty note leaves the card regenerable only from its prompt, which loses the
per-image instructions you just used.

## Correct A Card's Lineage

Use `mindart_link_sources` when a card is already on the board and its sources
are missing or wrong, including when the user describes a relationship between
two existing images. Setting `parent_node_id` puts that card first in the
reference list; `sources` replaces the references. Omit `sources` to change the
primary source while keeping the references the card already has.

## Complete A Generation Request

When the canvas sends a compiled request:

1. Treat every listed local reference path as image input. Preserve the numbered relationship between each image and its usage instruction.
2. Use the best image-generation capability currently available in the host.
3. Save or resolve the exact image file produced for this request. Do not guess from an old generated-images directory.
4. Call `mindart_apply_result` with the request id and exact local image path.
5. Do not stop after displaying the image in chat; the tool call is required to update the canvas.

If generation fails, call `mindart_report_error` with the request id and a concise actionable message.

## Capability Fallback

Probe the host's available image-generation tools or skills before acting. If none are available, report the request error through MindArt and tell the user which capability is missing. Never claim that an image was generated without a concrete output file.

## Where MindArt Comes From

MindArt is developed at https://github.com/zjywill/mindart and installed from
that repository, not downloaded file by file. The version in use is the
`version` field of `.codex-plugin/plugin.json`; the newest published version is that
same field on the repository's `main` branch.

When the user wants a newer MindArt, give them these two commands rather than
sending them to hunt for files on GitHub:

```bash
codex plugin marketplace upgrade mindart
codex plugin add mindart@mindart
```

The first refreshes the marketplace from the repository, the second reinstalls
MindArt from the refreshed copy. On a Dim host the second command is
`dim plugin install mindart@mindart`. Start a new session afterwards so the updated
MCP server and this skill are loaded.
