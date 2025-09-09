# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# 유틸(헬스체크용 curl) + PID1 처리용 tini
RUN apk add --no-cache curl tini

# 의존성 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

# 업로드 디렉터리 생성(컨테이너 외부 볼륨으로 마운트 권장)
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 3000

# 헬스체크: 루트 페이지 응답 확인
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD curl -fsS http://localhost:3000/ >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini","-g","--"]
CMD ["node","server.js"]
