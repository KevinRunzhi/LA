"""Document-driven multi-agent generation of governed case drafts."""

from .orchestrator import CaseGenerationService
from .templates import CaseGenerationTemplateRegistry

__all__ = ["CaseGenerationService", "CaseGenerationTemplateRegistry"]
