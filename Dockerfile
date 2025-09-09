# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

# 유틸/빌드도구 + tini
RUN apk add --no-cache curl tini python3 make g++

# 1) 의존성 메타만 먼저 복사(캐시 최적화)
COPY package.json package-lock.json* ./

# (선택) 만약 package.json에 mysql2가 아직 없다면 아래 한 줄을 임시로 활성화
# RUN npm pkg set dependencies.mysql2="^3.11.3"

# 2) lock 있으면 ci, 없으면 install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# 3) 앱 소스 복사
COPY . .

# 업로드 디렉터리 (호스트 볼륨 권장)
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 8080
ENTRYPOINT ["/sbin/tini","-g","--"]
CMD ["node","server.js"]
