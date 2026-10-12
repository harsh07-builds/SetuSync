package in.setusync.relay.acquisition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.util.Map;

@Component
@ConditionalOnProperty(
        prefix = "setusync.scheduler",
        name = "mode",
        havingValue = "eventbridge"
)
public class EventBridgeSchedulerConsumer {

    private static final Logger log =
            LoggerFactory.getLogger(EventBridgeSchedulerConsumer.class);

    private final SqsClient sqsClient;
    private final ObjectMapper objectMapper;
    private final String queueUrl;
    private final int maxMessages;
    private final int waitSeconds;

    private final ArchivePollingWorker archivePollingWorker;
    private final CapsuleCompilationWorker capsuleCompilationWorker;
    private final SubmissionRecoveryWorker submissionRecoveryWorker;

    public EventBridgeSchedulerConsumer(
            SqsClient sqsClient,
            ObjectMapper objectMapper,
            @Value("${setusync.scheduler.queue-url}")
            String queueUrl,
            @Value("${setusync.scheduler.max-messages:10}")
            int maxMessages,
            @Value("${setusync.scheduler.wait-seconds:10}")
            int waitSeconds,
            ArchivePollingWorker archivePollingWorker,
            CapsuleCompilationWorker capsuleCompilationWorker,
            SubmissionRecoveryWorker submissionRecoveryWorker
    ) {
        if (queueUrl == null || queueUrl.isBlank()) {
            throw new IllegalArgumentException(
                    "setusync.scheduler.queue-url must not be blank"
            );
        }

        if (maxMessages < 1 || maxMessages > 10) {
            throw new IllegalArgumentException(
                    "Scheduler max messages must be between 1 and 10"
            );
        }

        if (waitSeconds < 0 || waitSeconds > 20) {
            throw new IllegalArgumentException(
                    "Scheduler wait seconds must be between 0 and 20"
            );
        }

        this.sqsClient = sqsClient;
        this.objectMapper = objectMapper;
        this.queueUrl = queueUrl;
        this.maxMessages = maxMessages;
        this.waitSeconds = waitSeconds;
        this.archivePollingWorker = archivePollingWorker;
        this.capsuleCompilationWorker = capsuleCompilationWorker;
        this.submissionRecoveryWorker = submissionRecoveryWorker;
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.scheduler.poll-interval-ms:1000}"
    )
    public void pollSchedulerQueue() {
        ReceiveMessageRequest request =
                ReceiveMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .maxNumberOfMessages(maxMessages)
                        .waitTimeSeconds(waitSeconds)
                        .build();

        try {
            var response = sqsClient.receiveMessage(request);

            for (Message message : response.messages()) {
                process(message);
            }

        } catch (Exception exception) {
            log.error(
                    "EventBridge scheduler queue polling failed",
                    exception
            );
        }
    }

    private void process(Message message) {
        try {
            JsonNode event =
                    objectMapper.readTree(message.body());

            String task =
                    event.path("detail")
                            .path("task")
                            .asText("");

            if (task.isBlank()) {
                task = event.path("task").asText("");
            }

            if (task.isBlank()) {
                throw new IllegalArgumentException(
                        "Scheduler event has no task"
                );
            }

            runTask(task);

            sqsClient.deleteMessage(
                    DeleteMessageRequest.builder()
                            .queueUrl(queueUrl)
                            .receiptHandle(message.receiptHandle())
                            .build()
            );

        } catch (Exception exception) {
            log.error(
                    "EventBridge scheduler event failed; leaving message "
                            + "for SQS redelivery",
                    exception
            );
        }
    }

    private void runTask(String task) {
        switch (task) {
            case "archive-polling" ->
                    archivePollingWorker.pollArchives();

            case "capsule-compilation" ->
                    capsuleCompilationWorker.compileReadyCapsules();

            case "submission-recovery" ->
                    submissionRecoveryWorker.recoverStaleSubmissions();

            default ->
                    throw new IllegalArgumentException(
                            "Unknown scheduler task: " + task
                    );
        }

        log.debug(
                "Executed EventBridge scheduler task {}",
                task
        );
    }
}
