# LiveTemplate — 클라우드(HTTPS)에 올려 휴대폰에서 열거나 앱으로 설치할 때 사용
FROM node:22-alpine
WORKDIR /app

# 의존성 먼저 설치 (캐시 활용)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
# 템플릿·문서·비밀 노트가 저장되는 곳: 배포 서비스의 영구 디스크를 여기에 연결하세요
VOLUME /data
EXPOSE 3001
CMD ["npm", "start"]
