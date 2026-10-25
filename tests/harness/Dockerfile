ARG RUNTIME_IMAGE
FROM ${RUNTIME_IMAGE}
ARG BASELINE_SHA
LABEL booking.harness.baseline-sha=${BASELINE_SHA}
ARG MILESTONE2_SHA
LABEL booking.harness.milestone2-sha=${MILESTONE2_SHA}
ARG MILESTONE3_SHA
LABEL booking.harness.milestone3-sha=${MILESTONE3_SHA}
COPY --chmod=755 . /
ENTRYPOINT ["/usr/bin/node", "/harness/container.js"]
