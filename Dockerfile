FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    STRICT=1

WORKDIR /app

# 只拷运行时需要的东西：静态页面、游戏源码、Three.js 本地副本、静态服务器
COPY index.html styles.css server.mjs ./
COPY src/ ./src/
COPY vendor/ ./vendor/

USER node
EXPOSE 7860
CMD ["node", "server.mjs"]
