ARG BASE
FROM ${BASE}
ARG UBUNTU_MIRROR
ARG ARCH_MIRROR
RUN set -eu; \
    if command -v apt-get >/dev/null; then \
      if [ -f /etc/apt/sources.list.d/ubuntu.sources ] && [ -n "$UBUNTU_MIRROR" ]; then \
        sed -i "s|^URIs: .*|URIs: $UBUNTU_MIRROR|" /etc/apt/sources.list.d/ubuntu.sources; \
      fi; \
      apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o APT::Update::Error-Mode=any update && apt-get install -y sudo; \
    elif command -v dnf >/dev/null; then dnf install -y sudo shadow-utils; \
    else \
      if [ -n "$ARCH_MIRROR" ]; then sed -i "1i Server = $ARCH_MIRROR/\$repo/os/\$arch" /etc/pacman.d/mirrorlist; fi; \
      pacman -Syu --noconfirm --needed sudo shadow; \
    fi; \
    useradd -m -s /bin/bash factorytest; \
    printf 'factorytest ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/factorytest; \
    chmod 0440 /etc/sudoers.d/factorytest; \
    mkdir /home/factorytest/source; chown factorytest /home/factorytest/source
USER factorytest
ENV HOME=/home/factorytest
ENV PATH=/home/factorytest/.local/bin:${PATH}
ENV GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=Factory-Smoke GIT_CONFIG_KEY_1=user.email GIT_CONFIG_VALUE_1=factory-smoke@example.invalid
WORKDIR /home/factorytest/source
CMD ["sleep", "infinity"]
