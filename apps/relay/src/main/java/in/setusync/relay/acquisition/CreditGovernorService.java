package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.GovernorRepository;
import in.setusync.relay.persistence.GovernorRepository.ReservationResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class CreditGovernorService {

    private final GovernorRepository repository;

    private final long monthlyCreditBudget;
    private final long perInstallCreditQuota;
    private final boolean globalKillSwitch;
    private final String blockedEngines;

    public CreditGovernorService(
            GovernorRepository repository,
            @Value("${setusync.governor.monthly-credit-budget:0}")
            long monthlyCreditBudget,
            @Value("${setusync.governor.per-install-credit-quota:0}")
            long perInstallCreditQuota,
            @Value("${setusync.governor.global-kill-switch:false}")
            boolean globalKillSwitch,
            @Value("${setusync.governor.blocked-engines:}")
            String blockedEngines
    ) {
        this.repository = repository;
        this.monthlyCreditBudget =
                monthlyCreditBudget;
        this.perInstallCreditQuota =
                perInstallCreditQuota;
        this.globalKillSwitch =
                globalKillSwitch;
        this.blockedEngines =
                blockedEngines == null
                        ? ""
                        : blockedEngines;
    }

    public GovernorDecision approve(
            UUID jobId,
            UUID installId,
            String engine
    ) {
        /*
         * Hard gates are intentionally evaluated before any budget
         * reservation.
         */

        if (globalKillSwitch) {
            return GovernorDecision.denied(
                    "GLOBAL_KILL_SWITCH"
            );
        }

        if (isBlockedEngine(engine)) {
            return GovernorDecision.denied(
                    "DOMAIN_BLOCKED"
            );
        }

        /*
         * The current acquisition API does not carry an independent
         * pre-provider risk classification. Unknown risk is therefore
         * allowed with the manual's risk penalty applied to scoring.
         */
        double riskPenalty =
                1.25d;

        /*
         * The current /v1/search path represents interactive demand.
         * Scheduled refresh, prefetch and exploration will use their
         * own explicit bucket once those demand sources are introduced.
         */
        double reuse = 1.0d;
        double userValue = 1.0d;
        double freshnessGain = 1.0d;
        double locality = 1.0d;
        double queueAge = 1.0d;
        double distinctInstallEvidence = 1.0d;
        double providerCost = 1.0d;

        double priorityScore =
                (
                        reuse *
                        userValue *
                        freshnessGain *
                        locality *
                        queueAge *
                        distinctInstallEvidence
                ) /
                (
                        providerCost *
                        riskPenalty
                );

        if (!Double.isFinite(priorityScore)
                || priorityScore <= 0) {
            return GovernorDecision.denied(
                    "INVALID_PRIORITY"
            );
        }

        ReservationResult result =
                repository.reserveInteractive(
                        jobId,
                        installId,
                        monthlyCreditBudget,
                        perInstallCreditQuota
                );

        if (!result.approved()) {
            return GovernorDecision.denied(
                    result.reason()
            );
        }

        return GovernorDecision.approved(
                "interactive",
                priorityScore,
                result.reservedCredits()
        );
    }

    public void settle(
            UUID jobId,
            UUID installId,
            int actualCredits
    ) {
        repository.settle(
                jobId,
                installId,
                actualCredits
        );
    }

    private boolean isBlockedEngine(
            String engine
    ) {
        if (engine == null ||
                engine.isBlank()) {
            return true;
        }

        for (
                String configured :
                blockedEngines.split(",")
        ) {
            String value =
                    configured.trim();

            if (!value.isEmpty()
                    && value.equalsIgnoreCase(
                            engine.trim()
                    )) {
                return true;
            }
        }

        return false;
    }

    public record GovernorDecision(
            boolean approved,
            String reason,
            String bucket,
            double priorityScore,
            int reservedCredits
    ) {
        static GovernorDecision approved(
                String bucket,
                double score,
                int reservedCredits
        ) {
            return new GovernorDecision(
                    true,
                    "APPROVED",
                    bucket,
                    score,
                    reservedCredits
            );
        }

        static GovernorDecision denied(
                String reason
        ) {
            return new GovernorDecision(
                    false,
                    reason,
                    null,
                    0.0d,
                    0
            );
        }
    }
}