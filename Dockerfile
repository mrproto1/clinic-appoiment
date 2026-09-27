FROM php:8.2-cli

WORKDIR /var/www/html

COPY . /var/www/html

EXPOSE 10000

CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-10000} -t /var/www/html"]
