ARG DB_IMAGE
FROM ${DB_IMAGE}
# The upstream VOLUME would discard the seeded layer under the legacy builder.
ENV PGDATA=/var/lib/p2a-moodle POSTGRES_DB=moodle POSTGRES_USER=moodle POSTGRES_HOST_AUTH_METHOD=trust
COPY moodle.dump /tmp/moodle.dump
RUN set -eu; \
    mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; \
    gosu postgres initdb -D "$PGDATA" --auth=trust; \
    gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start; \
    gosu postgres createuser --superuser moodle; \
    gosu postgres createdb --owner=moodle moodle; \
    pg_restore -U moodle --exit-on-error --no-owner -d moodle /tmp/moodle.dump; \
    gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop; \
    printf 'host all all 0.0.0.0/0 trust\nhost all all ::/0 trust\n' >> "$PGDATA/pg_hba.conf" ; \
    rm /tmp/moodle.dump
HEALTHCHECK --interval=1s --timeout=3s --retries=60 CMD pg_isready -U moodle -d moodle
