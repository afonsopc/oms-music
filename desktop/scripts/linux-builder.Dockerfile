# Imagem de build Linux do shell desktop (plano F5 / 3.6). Ubuntu 22.04 de
# proposito: e a base mais antiga suportada com webkit2gtk-4.1, por isso o
# glibc contra o qual linkamos e o minimo comum - o binario corre em tudo o
# que for igual ou mais recente. Construir em algo mais novo daria um .deb
# que morre com "GLIBC_2.3x not found" em metade das distros.
#
# Usada exclusivamente por scripts/build-linux.sh; nada aqui publica nada.
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# A lista canonica de deps de build do Tauri v2 em Debian/Ubuntu, mais o que
# o bundler precisa para o .deb (dpkg tooling ja vem) e para o AppImage
# (file, wget, desktop-file-utils, squashfs). libayatana-appindicator3-dev
# e o header do tray (em runtime o .deb declara a alternativa
# "libappindicator3-1 | libayatana-appindicator3-1").
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    wget \
    file \
    git \
    pkg-config \
    unzip \
    xz-utils \
    patchelf \
    desktop-file-utils \
    squashfs-tools \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libxdo-dev \
    libssl-dev \
  && rm -rf /var/lib/apt/lists/*

# Rust estavel via rustup, perfil minimo. A versao nao e pinada: o Cargo.lock
# do projecto e que fixa as deps, e o shell nao usa nightly features.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable

# bun so para trazer o CLI do Tauri, instalado GLOBALMENTE na imagem: o
# node_modules/ do host e macOS (binario darwin do @tauri-apps/cli) e nunca
# pode ser o que corre aqui dentro. Versao pinada = a mesma do package.json
# de desktop/.
RUN curl -fsSL https://bun.sh/install | bash \
  && /root/.bun/bin/bun add -g @tauri-apps/cli@2.11.4

ENV PATH="/root/.cargo/bin:/root/.bun/bin:${PATH}"

WORKDIR /work/desktop
