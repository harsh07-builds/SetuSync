package in.setusync.relay.acquisition;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@ConditionalOnProperty(
        prefix = "setusync.scheduler",
        name = "mode",
        havingValue = "local",
        matchIfMissing = true
)
@EnableScheduling
public class OutboxSchedulingConfiguration {
}
