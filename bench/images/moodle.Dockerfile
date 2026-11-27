ARG WEB_IMAGE
FROM ${WEB_IMAGE}
ARG DOCROOT=/var/www/html
ENV APACHE_DOCUMENT_ROOT=${DOCROOT} \
    MOODLE_DOCKER_RUNNING=1 MOODLE_DOCKER_DBTYPE=pgsql \
    MOODLE_DOCKER_DBNAME=moodle MOODLE_DOCKER_DBUSER=moodle MOODLE_DOCKER_DBPASS="" \
    MOODLE_DOCKER_BROWSER=chrome MOODLE_DOCKER_WEB_HOST=localhost MOODLE_DOCKER_TIMEOUT_FACTOR=1
WORKDIR /var/www/html
COPY source/ ./
COPY study-behat/ /opt/study-behat/
ADD behatdata.tar /var/www/behatdata/
RUN mkdir -p /var/www/moodledata /var/www/behatfaildumps \
    && chown -R www-data:www-data /var/www/moodledata /var/www/behatdata /var/www/behatfaildumps
HEALTHCHECK --interval=1s --timeout=8s --retries=60 CMD curl -fsS -H 'Host: webserver' http://127.0.0.1/login/index.php | grep -q 'Log in'
