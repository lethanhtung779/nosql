FROM node:20-alpine AS build
WORKDIR /app
ENV API_INTERNAL_URL=http://api:3001
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build -w @spa/web

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV API_INTERNAL_URL=http://api:3001
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY package.json ./package.json
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@spa/web"]
