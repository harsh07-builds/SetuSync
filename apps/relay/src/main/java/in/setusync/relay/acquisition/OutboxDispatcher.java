package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.OutboxRepository;
import in.setusync.relay.persistence.OutboxRepository.OutboxEvent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
@ConditionalOnProperty(
        prefix = "setusync.acquisition.queue",
        name = "mode",
        havingValue = "local",
        matchIfMissing = true
)
public class OutboxDispatcher {

    private static final Logger log =
            LoggerFactory.getLogger(OutboxDispatcher.class);

    private static final int BATCH_SIZE = 25;
    private static final int LEASE_SECONDS = 60;
    private static final int RETRY_DELAY_SECONDS = 30;

    private final OutboxRepository outboxRepository;
    private final Map<String, OutboxEventHandler> handlers;

    public OutboxDispatcher(
            OutboxRepository outboxRepository,
            List<OutboxEventHandler> eventHandlers
    ) {
        this.outboxRepository = outboxRepository;

        Map<String, OutboxEventHandler> registeredHandlers =
                new HashMap<>();

        for (OutboxEventHandler handler : eventHandlers) {
            String eventType = handler.eventType();

            if (eventType == null || eventType.isBlank()) {
                throw new IllegalStateException(
                        "An outbox handler has an empty event type"
                );
            }

            OutboxEventHandler previous =
                    registeredHandlers.putIfAbsent(
                            eventType,
                            handler
                    );

            if (previous != null) {
                throw new IllegalStateException(
                        "Duplicate outbox handler for event type: "
                                + eventType
                );
            }
        }

        this.handlers = Map.copyOf(registeredHandlers);
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.outbox.poll-interval-ms:1000}"
    )
    public void dispatchPendingEvents() {
        List<OutboxEvent> events;

        try {
            events = outboxRepository.claimPending(
                    BATCH_SIZE,
                    LEASE_SECONDS
            );
        } catch (Exception exception) {
            log.error(
                    "Could not claim pending outbox events",
                    exception
            );
            return;
        }

        for (OutboxEvent event : events) {
            dispatchOne(event);
        }
    }

    private void dispatchOne(
            OutboxEvent event
    ) {
        try {
            OutboxEventHandler handler =
                    handlers.get(event.eventType());

            if (handler == null) {
                throw new IllegalStateException(
                        "No handler registered for event type: "
                                + event.eventType()
                );
            }

            handler.handle(event);

            boolean acknowledged =
                    outboxRepository.markPublished(
                            event.id(),
                            event.claimToken()
                    );

            if (!acknowledged) {
                log.warn(
                        "Outbox event {} was handled but its claim "
                                + "could not be acknowledged",
                        event.id()
                );
                return;
            }

        } catch (Exception exception) {
            log.error(
                    "Outbox event {} dispatch failed",
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
                        "Could not release outbox event {} for retry",
                        event.id(),
                        releaseException
                );
            }
        }
    }
}