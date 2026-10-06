FROM composer:2 AS dependencies
WORKDIR /app
COPY . .
RUN composer install --no-interaction --prefer-dist --no-progress

FROM php:8.4-cli
RUN apt-get update && apt-get install -y --no-install-recommends libzip-dev libicu-dev libxml2-dev libsqlite3-dev libonig-dev \
    && docker-php-ext-install pdo_mysql pdo_sqlite mbstring xml intl zip \
    && rm -rf /var/lib/apt/lists/*
# Keep PHP's transport limit aligned with API validation while allowing multipart form overhead.
RUN { echo 'upload_max_filesize=10M'; echo 'post_max_size=11M'; } > /usr/local/etc/php/conf.d/uploads.ini
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html
COPY --from=dependencies /app/vendor ./vendor
COPY . .
RUN mkdir -p storage/app/documents storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache
EXPOSE 8000
# Demo startup is self-contained: migrations and idempotent seed data run before the API accepts requests.
CMD ["sh", "-c", "php artisan migrate --force && php artisan db:seed --force && php artisan serve --host=0.0.0.0 --port=8000"]
