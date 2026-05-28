ARG PYTHON_BASE_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_BASE_IMAGE}

ARG DEBIAN_APT_MIRROR=
ARG DEBIAN_SECURITY_APT_MIRROR=
ARG APT_ACQUIRE_RETRIES=3

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/opt/sciforge-computer-use

RUN set -eux; \
    if [ -n "${DEBIAN_SECURITY_APT_MIRROR}" ]; then \
        sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -n "${DEBIAN_APT_MIRROR}" ]; then \
        sed -i \
            -e "s|http://deb.debian.org/debian$|${DEBIAN_APT_MIRROR}|g" \
            -e "s|http://deb.debian.org/debian |${DEBIAN_APT_MIRROR} |g" \
            /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get -o Acquire::Retries="${APT_ACQUIRE_RETRIES}" update \
    && apt-get -o Acquire::Retries="${APT_ACQUIRE_RETRIES}" install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-dejavu \
        imagemagick \
        libreoffice-writer \
        novnc \
        openbox \
        scrot \
        websockify \
        x11vnc \
        xdotool \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/sciforge-computer-use
COPY pyproject.toml README.md ./
COPY sciforge_computer_use ./sciforge_computer_use

ENTRYPOINT ["python", "-m", "sciforge_computer_use.isolated_desktop_l1_smoke_probe"]
CMD ["--help"]
