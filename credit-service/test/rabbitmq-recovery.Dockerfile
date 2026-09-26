FROM rabbitmq:4.3.6-management-alpine

# Keep recovery state outside the base image's predeclared data volume. Docker
# Desktop otherwise copies its root-owned cookie into every anonymous volume.
USER root
RUN mkdir -p /var/lib/rabbitmq-recovery/mnesia \
    && chown -R rabbitmq:rabbitmq /var/lib/rabbitmq-recovery
