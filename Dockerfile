FROM docker.io/moon11000/a-feed21-v3-ssh:v1

WORKDIR /app
ENV NODE_ENV=production

# Replace only the UI/path files; dependencies remain from the original image.
COPY app/dist/server.cjs ./dist/server.cjs
COPY app/dist/server.cjs.map ./dist/server.cjs.map
COPY app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.cjs"]
