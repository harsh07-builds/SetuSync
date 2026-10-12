package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.OutboxRepository.OutboxEvent;

public interface OutboxEventHandler {

    /**
     * Returns the exact outbox event type handled by this component.
     */
    String eventType();

    /**
     * Handles one claimed outbox event.
     *
     * Implementations must be idempotent because an event may
     * be delivered again after a restart or lease expiry.
     *
     * Throw an exception if handling fails so the dispatcher
     * can release the event for retry.
     */
    void handle(OutboxEvent event);
}