package in.setusync.relay.acquisition;

public enum SchedulerTask {

    ARCHIVE_POLLING("archive-polling"),
    CAPSULE_COMPILATION("capsule-compilation"),
    SUBMISSION_RECOVERY("submission-recovery");

    private final String value;

    SchedulerTask(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
