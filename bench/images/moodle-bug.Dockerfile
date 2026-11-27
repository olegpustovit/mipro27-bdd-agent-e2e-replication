ARG MOODLE_WEB
FROM ${MOODLE_WEB}
COPY overlay/ /var/www/html/
