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

# ---- Стиль A: смелый дудл, толстый чёрный контур, весёлый (как референс с котами) ----
STYLE_A=", bold whimsical flat vector doodle illustration, thick black hand-drawn outlines, playful cheerful style, flat bright colors, simple charming imperfect linework, no gradients, no shading, plain white background, fun and bouncy energy"
gen "a-kedi" "A sitting orange tabby cat, front-facing, big friendly smile${STYLE_A}"
gen "a-kosmak" "A cheerful child running joyfully, dynamic mid-stride pose${STYLE_A}"
gen "a-buyuk" "Two round balls side by side, the left one large and bright gold, the right one small and flat grey${STYLE_A}"

# ---- Стиль B: глянцевая детальная иллюстрация с градиентами (как референс с птичкой) ----
STYLE_B=", highly detailed vector illustration, soft gradients and cel-shading, glossy highlights, rich fine texture detail (fur, fabric folds), polished premium sticker style, vibrant saturated colors, soft drop shadow beneath subject, plain white background"
gen "b-kedi" "A sitting orange tabby cat, front-facing, friendly expression${STYLE_B}"
gen "b-kosmak" "A cheerful child running joyfully, dynamic mid-stride pose${STYLE_B}"
gen "b-buyuk" "Two round wooden balls side by side, the left one large and warm gold, the right one small and neutral grey${STYLE_B}"

# ---- Стиль C: современный papercut / слоистая бумага, элегантный ----
STYLE_C=", modern layered papercut illustration, dimensional paper layers with soft subtle drop shadows between layers, elegant muted premium color palette, clean geometric simplified shapes, delicate grain texture, plain white background, sophisticated and chic"
gen "c-kedi" "A sitting tabby cat, front-facing, simplified elegant shapes${STYLE_C}"
gen "c-kosmak" "A child running joyfully, dynamic mid-stride pose, simplified elegant shapes${STYLE_C}"
gen "c-buyuk" "Two round balls side by side, the left one large and warm gold-toned paper layer, the right one small and grey paper layer${STYLE_C}"

# ---- Стиль D: мягкая акварель, сказочный премиум ----
STYLE_D=", soft watercolor and gouache illustration, gentle painterly brush texture, delicate premium muted color palette, fairy-tale storybook art, fine elegant linework, dreamy soft light, plain white background"
gen "d-kedi" "A sitting orange tabby cat, front-facing, gentle expression${STYLE_D}"
gen "d-kosmak" "A cheerful child running joyfully, dynamic mid-stride pose${STYLE_D}"
gen "d-buyuk" "Two round balls side by side, the left one large and warm gold, the right one small and soft grey${STYLE_D}"

echo "DONE"
