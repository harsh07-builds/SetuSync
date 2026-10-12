package in.setusync.relay.acquisition;

import com.fasterxml.jackson.databind.ObjectMapper;
import in.setusync.relay.persistence.OutboxRepository;
import in.setusync.relay.persistence.OutboxRepository.OutboxEvent;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
@ConditionalOnProperty(
        prefix = "setusync.acquisition.queue",
        name = "mode",
        havingValue = "sqs"
)
public class SqsOutboxPublisher {

    private static final Logger log =
            LoggerFactory.getLogger(SqsOutboxPublisher.class);

    private static final int BATCH_SIZE = 10;
    private static final int LEASE_SECONDS = 120;
    private static final int RETRY_DELAY_SECONDS = 30;

    private final OutboxRepository outboxRepository;
    private final SqsClient sqsClient;
    private final ObjectMapper objectMapper;
    private final String queueUrl;
    private final AtomicBoolean acceptingWork =
            new AtomicBoolean(true);

    public SqsOutboxPublisher(
            OutboxRepository outboxRepository,
            SqsClient sqsClient,
            ObjectMapper objectMapper,
            @Value("${setusync.acquisition.queue.url}")
            String queueUrl
    ) {
        this.outboxRepository = outboxRepository;
        this.sqsClient = sqsClient;
        this.objectMapper = objectMapper;

        if (queueUrl == null || queueUrl.isBlank()) {
            throw new IllegalArgumentException(
                    "setusync.acquisition.queue.url is required"
            );
        }

        this.queueUrl = queueUrl;
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.outbox.poll-interval-ms:1000}"
    )
    public void publishPendingEvents() {
        if (!acceptingWork.get()) {
            return;
        }

        List<OutboxEvent> events;

        try {
            events = outboxRepository.claimPending(
                    BATCH_SIZE,
                    LEASE_SECONDS
            );
        } catch (Exception exception) {
            if (acceptingWork.get()) {
                log.error(
                        "Could not claim pending outbox events for SQS",
                        exception
                );
            }
            return;
        }

        for (OutboxEvent event : events) {
            if (!acceptingWork.get()) {
                log.info(
                        "SQS outbox publisher is shutting down; "
                                + "remaining claimed events will expire "
                                + "their database lease"
                );
                return;
            }

            publishOne(event);
        }
    }

    private void publishOne(
            OutboxEvent event
    ) {
        try {
            String message =
                    objectMapper.writeValueAsString(
                            new SqsEnvelope(
                                    event.id(),
                                    event.aggregateType(),
                                    event.aggregateId(),
                                    event.eventType(),
                                    event.payloadJson()
                            )
                    );

            sqsClient.sendMessage(
                    SendMessageRequest.builder()
                            .queueUrl(queueUrl)
                            .messageBody(message)
                            .build()
            );

            boolean acknowledged =
                    outboxRepository.markPublished(
                            event.id(),
                            event.claimToken()
                    );

            if (!acknowledged) {
                log.warn(
                        "SQS accepted outbox event {} but the "
                                + "database claim could not be acknowledged",
                        event.id()
                );
                return;
            }

            log.debug(
                    "Outbox event {} published to SQS",
                    event.id()
            );

        } catch (Exception exception) {
            log.error(
                    "Could not publish outbox event {} to SQS",
                    event.id(),
                    exception
            );

            try {
                outboxRepository.releaseForRetry(
                        event.id(),
                        event.claimToken(),
                        RETRY_DELAY_SECONDS,
                        exception.getClass()
                                .getSimpleName()
                                + ": "
                                + exception.getMessage()
                );
            } catch (Exception releaseException) {
                log.error(
                        "Could not release SQS outbox event {}",
                        event.id(),
                        releaseException
                );
            }
        }
    }

    @PreDestroy
    public void shutdown() {
        if (acceptingWork.compareAndSet(true, false)) {
            log.info(
                    "SQS outbox publisher stopping; no new events will be claimed"
            );
        }
    }

    public record SqsEnvelope(
            UUID eventId,
            String aggregateType,
            String aggregateId,
            String eventType,
            String payloadJson
    ) {
    }
}
