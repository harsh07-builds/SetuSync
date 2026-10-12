# ---- build -------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package \
 && cp target/relay-*.jar /build/relay.jar

# ---- run ---------------------------------------------------------------
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/relay.jar /app/relay.jar

# Capsules are written here when SETUSYNC_OBJECT_STORE_PROVIDER=local.
# Mount a volume on /app/data to keep them across restarts.
RUN mkdir -p /app/data/capsules
VOLUME /app/data

EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
ENTRYPOINT ["java", "-jar", "/app/relay.jar"]
