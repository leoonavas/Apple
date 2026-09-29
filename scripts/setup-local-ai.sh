#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Este instalador sem Homebrew usa ferramentas nativas do macOS. Em outros sistemas, instale whisper.cpp e FFmpeg manualmente; configure os caminhos em .env.local."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TOOLS="$ROOT/.data/bin"
SOURCE="$ROOT/.data/local-ai/whisper.cpp"
BUILD="$ROOT/.data/local-ai/whisper-build"
VENV="$ROOT/.data/local-ai/python"
MODEL="$ROOT/models/ggml-medium-q5_0.bin"
JOBS="$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)"

mkdir -p "$TOOLS" "$ROOT/models" "$ROOT/.data/local-ai"

if [[ ! -x "$TOOLS/whisper-cli" ]]; then
  if [[ ! -x "$VENV/bin/cmake" ]]; then
    python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --disable-pip-version-check cmake
  fi

  if [[ ! -f "$SOURCE/CMakeLists.txt" ]]; then
    ARCHIVE="$ROOT/.data/local-ai/whisper.cpp-v1.9.4.tar.gz"
    curl --fail --location --retry 3 --output "$ARCHIVE" \
      https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz
    mkdir -p "$SOURCE"
    tar -xzf "$ARCHIVE" --strip-components=1 -C "$SOURCE"
    rm -f "$ARCHIVE"
  fi

  "$VENV/bin/cmake" -S "$SOURCE" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release
  "$VENV/bin/cmake" --build "$BUILD" --config Release --target whisper-cli --parallel "$JOBS"
  cp "$BUILD/bin/whisper-cli" "$TOOLS/whisper-cli"
  chmod 700 "$TOOLS/whisper-cli"
fi

if [[ ! -f "$TOOLS/apple-media" ]]; then
  swiftc "$ROOT/scripts/apple-media.swift" -o "$TOOLS/apple-media" \
    -framework AppKit -framework PDFKit -framework Vision
  chmod 700 "$TOOLS/apple-media"
fi

if [[ ! -f "$MODEL" ]]; then
  curl --fail --location --retry 3 --output "$MODEL" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin
fi

echo "Transcrição Whisper e OCR Vision instalados localmente em .data/. O modelo Whisper fica em models/."
if command -v ollama >/dev/null 2>&1; then
  echo "Ollama encontrado. Para instalar o modelo de interpretação (~3 GB), execute: ollama pull gemma3:4b"
else
  echo "Instale o Ollama para macOS em https://ollama.com/download e abra Ollama.app."
  echo "Depois, execute: ollama pull gemma3:4b"
fi
echo "Para OCR local no macOS, o aplicativo usa Vision/PDFKit; não precisa de Tesseract ou Poppler."
