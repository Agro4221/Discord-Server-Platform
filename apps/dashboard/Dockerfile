FROM node:24.17.0-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/dashboard/package*.json apps/dashboard/
RUN npm ci
COPY apps/dashboard apps/dashboard
RUN npm run build -w apps/dashboard

FROM node:24.17.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/dashboard/.next ./apps/dashboard/.next
COPY --from=build /app/apps/dashboard/package.json ./apps/dashboard/package.json
WORKDIR /app/apps/dashboard
CMD ["npm", "start"]
