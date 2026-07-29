#!/bin/bash
set -uo pipefail

KEY_FILE="$HOME/.mahjong-openai-key"
OUT_DIR="/Users/apr/mahjong-prototype/assets/style-test"
mkdir -p "$OUT_DIR"

gen() {
  local name="$1"
  local prompt="$2"
  local out="$OUT_DIR/$name.png"
  if [ -f "$out" ]; then
    echo "skip $name (already exists)"
    return
  fi
  echo "generating $name..."
  local payload
  payload=$(jq -n --arg p "$prompt" '{model:"gpt-image-1", prompt:$p, size:"1024x1024", background:"opaque", n:1}')
  local resp
  resp=$(curl -s https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer $(cat "$KEY_FILE")" \
    -H "Content-Type: application/json" \
    -d "$payload")
  local b64
  b64=$(echo "$resp" | jq -r '.data[0].b64_json // empty' 2>/dev/null || true)
  if [ -z "$b64" ]; then
    echo "FAILED $name: $(echo "$resp" | head -c 300)"
    sleep 5
    return
  fi
  echo "$b64" | base64 -D -o "$out"
  echo "saved $name -> $out"
  sleep 8
}

DETAIL=", detailed premium illustration, soft cel-shading and rendering, rich fine texture (fur, fabric, paper grain), vibrant warm color palette, glossy soft highlights, adorable charming character design, elegant premium quality, no text, no watermark"

gen "e1-kawaii-plain" "An adorable kawaii-style orange tabby cat mascot, oversized round head, tiny round chubby body, huge sparkling round eyes, tiny stubby paws, cute sitting pose${DETAIL}, plain solid soft pastel mint-green background, no scene elements, no ground"

gen "e2-kawaii-scene" "An adorable kawaii-style orange tabby cat mascot, oversized round head, tiny round chubby body, huge sparkling round eyes, tiny stubby paws, cute sitting pose, sitting on a small patch of grass with a couple of simple leaves nearby and a soft shadow${DETAIL}, gentle environmental context around the subject"

gen "e3-semi-plain" "A cute stylized orange tabby cat, natural but slightly cartoonish proportions (not exaggerated chibi), big expressive eyes, soft rounded shapes, cute sitting pose${DETAIL}, plain solid soft pastel mint-green background, no scene elements, no ground"

gen "e4-semi-scene" "A cute stylized orange tabby cat, natural but slightly cartoonish proportions (not exaggerated chibi), big expressive eyes, soft rounded shapes, cute sitting pose, sitting on a small patch of grass with a couple of simple leaves nearby and a soft shadow${DETAIL}, gentle environmental context around the subject"

echo "DONE"
