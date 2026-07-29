#!/bin/bash
set -uo pipefail

KEY_FILE="$HOME/.mahjong-openai-key"
OUT_DIR="/Users/apr/mahjong-prototype/assets/icons"
mkdir -p "$OUT_DIR"

# Утверждённый стиль E2: kawaii-маскот (крупная голова, огромные глаза, пухлое тело)
# + лёгкая сценка (травка/листики/тень) + богатая детализация/текстура/мягкий рендер.
STYLE=", adorable kawaii-style mascot character design, oversized rounded shapes, huge sparkling eyes, tiny cute proportions, detailed premium illustration, soft cel-shading and rendering, rich fine texture, vibrant warm color palette, glossy soft highlights, sitting on a small patch of grass with a couple of simple leaves nearby and a soft shadow, gentle environmental context around the subject, elegant premium quality, no text, no watermark"

# Для контрастных пар (büyük/küçük) лицо не добавляем — чтобы не размывать чтение "цветной = цель, серый = фон".
STYLE_CONTRAST=", adorable plump rounded kawaii-style shapes, soft glossy highlights, detailed premium illustration, soft cel-shading, rich fine texture, sitting on a small patch of grass with a couple of simple leaves nearby and a soft shadow, gentle environmental context, elegant premium quality, no text, no watermark, no face"

gen() {
  local word="$1"
  local subject="$2"
  local style="${3:-$STYLE}"
  local out="$OUT_DIR/$word.png"
  if [ -f "$out" ]; then
    echo "skip $word (already exists)"
    return
  fi
  echo "generating $word..."
  local prompt="${subject}${style}"
  local payload
  payload=$(jq -n --arg p "$prompt" '{model:"gpt-image-1", prompt:$p, size:"1024x1024", quality:"medium", background:"opaque", n:1}')
  local resp
  resp=$(curl -s https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer $(cat "$KEY_FILE")" \
    -H "Content-Type: application/json" \
    -d "$payload")
  local b64
  b64=$(echo "$resp" | jq -r '.data[0].b64_json // empty' 2>/dev/null || true)
  if [ -z "$b64" ]; then
    echo "FAILED $word: $(echo "$resp" | head -c 300)"
    sleep 10
    return
  fi
  echo "$b64" | base64 -D -o "$out"
  echo "saved $word -> $out"
  sleep 10
}

gen "kitap" "A cute chibi stack of two plump rounded storybooks with a friendly face peeking from the top cover, big sparkling eyes and rosy cheeks, warm burgundy and gold covers"
gen "cay" "A cute chibi Turkish tulip-shaped tea glass character with a friendly face, big sparkling eyes and rosy cheeks, on its saucer, warm amber tea, glossy highlights"
gen "ekmek" "A cute chibi round loaf of bread character with a friendly face, big sparkling eyes and rosy cheeks, golden brown crust, plump rounded shape"
gen "su" "A cute chibi water droplet character with a friendly face, big sparkling eyes and rosy cheeks, bright blue glossy plump body"
gen "ev" "A cute chibi small cottage character with a friendly face on its front door, round windows like eyes, warm cozy colors, plump rounded roof"
gen "araba" "A cute chibi small car character with a friendly face on the front (round headlight eyes, grille smile), cheerful red glossy rounded body"
gen "kedi" "An adorable kawaii-style orange tabby cat mascot, oversized round head, tiny round chubby body, huge sparkling round eyes, tiny stubby paws, cute sitting pose"
gen "kopek" "A cute chibi sitting brown and white puppy mascot, oversized round head, tiny chubby body, huge sparkling eyes, floppy ears, tiny wagging tail"
gen "gunes" "A cute chibi sun character with a warm friendly face, big sparkling eyes and rosy cheeks, simple rounded rays, golden yellow glossy body"
gen "ay" "A cute chibi crescent moon character with a gentle sleepy friendly face, big sparkling eyes, soft golden glow, tiny stars nearby"
gen "kosmak" "A cheerful chibi child mascot running joyfully, oversized round head, huge sparkling eyes, tiny chubby body, dynamic mid-stride pose, arms swinging"
gen "yuzmek" "A cheerful chibi child mascot swimming through gentle wavy water, oversized round head, huge sparkling eyes, tiny chubby body, mid-stroke pose, small splashes"
gen "okumak" "A cheerful chibi child mascot sitting cross-legged reading a big open book, oversized round head, huge sparkling eyes, tiny chubby body"
gen "yazmak" "A cute chibi plump pencil character with a friendly face writing on a sheet of paper, big sparkling eyes, a few visible cute wavy pencil lines"
gen "uyumak" "A cheerful chibi child mascot sleeping peacefully curled up on a small pillow with a cozy blanket, oversized round head, tiny chubby body, gentle closed sleepy eyes, cute Z symbols floating above"
gen "yurumek" "A cheerful chibi child mascot walking calmly, oversized round head, huge sparkling eyes, tiny chubby body, one foot forward, relaxed happy pose, arms swinging gently"
gen "buyuk" "Two plump rounded balls side by side, the left one large glossy painted in warm bright gold with soft highlights, the right one small and rendered in flat neutral grey" "$STYLE_CONTRAST"
gen "kucuk" "Two plump rounded balls side by side, the left one small glossy painted in warm bright gold with soft highlights, the right one large and rendered in flat neutral grey" "$STYLE_CONTRAST"

echo "DONE"
