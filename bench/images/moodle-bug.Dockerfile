ARG MOODLE_WEB
FROM ${MOODLE_WEB}
COPY overlay/ /var/www/html/
# The healthy base image holds caches built from the unpatched code (theme CSS, templates,
# strings, JavaScript). Clear them so the site serves the patched files.
RUN for d in /var/www/behatdata/behatrun /var/www/moodledata; do \
      if [ -d "$d" ]; then rm -rf "$d"/cache/* "$d"/localcache/* "$d"/temp/*; fi; \
    done
