package in.setusync.relay.acquisition;

import com.fasterxml.jackson.databind.ObjectMapper;
import in.setusync.relay.persistence.OutboxRepository.OutboxEvent;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
@ConditionalOnProperty(
        prefix = "setusync.acquisition.queue",
        name = "mode",
        havingValue = "sqs"
)
public class SqsOutboxConsumer {

    private static final Logger log =
            LoggerFactory.getLogger(SqsOutboxConsumer.class);

    private static final int MAX_MESSAGES = 10;

    private final SqsClient sqsClient;
    private final ObjectMapper objectMapper;
    private final String queueUrl;
    private final int visibilityTimeoutSeconds;
    private final Map<String, OutboxEventHandler> handlers;
    private final AtomicBoolean acceptingWork =
            new AtomicBoolean(true);

    public SqsOutboxConsumer(
            SqsClient sqsClient,
            ObjectMapper objectMapper,
            @Value("${setusync.acquisition.queue.url}")
            String queueUrl,
            @Value(
                    "${setusync.acquisition.queue.visibility-timeout-seconds:120}"
            )
            int visibilityTimeoutSeconds,
            List<OutboxEventHandler> eventHandlers
    ) {
        this.sqsClient = sqsClient;
        this.objectMapper = objectMapper;

        if (queueUrl == null || queueUrl.isBlank()) {
            throw new IllegalArgumentException(
                    "setusync.acquisition.queue.url is required"
            );
        }

        if (visibilityTimeoutSeconds <= 0) {
            throw new IllegalArgumentException(
                    "SQS visibility timeout must be positive"
            );
        }

        this.queueUrl = queueUrl;
        this.visibilityTimeoutSeconds =
                visibilityTimeoutSeconds;

        Map<String, OutboxEventHandler> registered =
                new HashMap<>();

        for (OutboxEventHandler handler : eventHandlers) {
            if (handler.eventType() == null ||
                    handler.eventType().isBlank()) {
                throw new IllegalStateException(
                        "An outbox handler has an empty event type"
                );
            }

            OutboxEventHandler previous =
                    registered.putIfAbsent(
                            handler.eventType(),
                            handler
                    );

            if (previous != null) {
                throw new IllegalStateException(
                        "Duplicate outbox handler for event type: "
                                + handler.eventType()
                );
            }
        }

        this.handlers = Map.copyOf(registered);
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.acquisition.queue.poll-interval-ms:1000}"
    )
    public void consume() {
        if (!acceptingWork.get()) {
            return;
        }

        List<Message> messages;

        try {
            messages =
                    sqsClient.receiveMessage(
                            ReceiveMessageRequest.builder()
                                    .queueUrl(queueUrl)
                                    .maxNumberOfMessages(
                                            MAX_MESSAGES
                                    )
                                    .visibilityTimeout(
                                            visibilityTimeoutSeconds
                                    )
                                    .waitTimeSeconds(10)
                                    .build()
                    )
                            .messages();

        } catch (Exception exception) {
            if (acceptingWork.get()) {
                log.error(
                        "Could not receive messages from SQS",
                        exception
                );
            }
            return;
        }

        if (!acceptingWork.get()) {
            return;
        }

        for (Message message : messages) {
            if (!acceptingWork.get()) {
                log.info(
                        "SQS consumer is shutting down; leaving remaining "
                                + "messages for redelivery"
                );
                return;
            }

            consumeOne(message);
        }
    }

    private void consumeOne(
            Message message
    ) {
        try {
            SqsOutboxPublisher.SqsEnvelope envelope =
                    objectMapper.readValue(
                            message.body(),
                            SqsOutboxPublisher.SqsEnvelope.class
                    );

            if (envelope.eventId() == null) {
                throw new IllegalArgumentException(
                        "SQS outbox message has no event ID"
                );
            }

            if (envelope.eventType() == null ||
                    envelope.eventType().isBlank()) {
                throw new IllegalArgumentException(
                        "SQS outbox message has no event type"
                );
            }

            OutboxEventHandler handler =
                    handlers.get(
                            envelope.eventType()
                    );

            if (handler == null) {
                throw new IllegalStateException(
                        "No handler registered for SQS event type: "
                                + envelope.eventType()
                );
            }

            OutboxEvent event =
                    new OutboxEvent(
                            envelope.eventId(),
                            envelope.aggregateType(),
                            envelope.aggregateId(),
                            envelope.eventType(),
                            envelope.payloadJson(),
                            null
                    );

            handler.handle(event);

            sqsClient.deleteMessage(
                    DeleteMessageRequest.builder()
                            .queueUrl(queueUrl)
                            .receiptHandle(
                                    message.receiptHandle()
                            )
                            .build()
            );

            log.debug(
                    "SQS outbox message {} handled and deleted",
                    envelope.eventId()
            );

        } catch (Exception exception) {
            log.error(
                    "SQS outbox message {} failed; leaving it "
                            + "for redelivery",
                    message.messageId(),
                    exception
            );
        }
    }

    @PreDestroy
    public void shutdown() {
        if (acceptingWork.compareAndSet(true, false)) {
            log.info(
                    "SQS outbox consumer stopping; no new messages will be claimed"
            );
        }
    }
}
