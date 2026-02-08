"""
Capability vocabulary for healthcare facility fact normalization.

This module contains:
1. SEED_CAPABILITIES: Human-curated starter vocabulary
2. LLM prompt template for fact→code mapping with new code proposals
3. Utilities for vocabulary management
"""

from typing import TypedDict, Optional
import json

# =============================================================================
# SEED CAPABILITY VOCABULARY
# =============================================================================
# These codes represent high-value capabilities for:
# - Medical desert detection (surgery, emergency, blood bank, imaging)
# - Routing decisions (24/7 availability, specialties)
# - Future anomaly detection (logical groupings)

SEED_CAPABILITIES: dict[str, str] = {
    # Emergency & Critical Care
    "emergency_24_7": "24-hour emergency department or services",
    "icu_available": "Intensive Care Unit capability",
    "trauma_care": "Trauma or accident care capability",
    
    # Surgical
    "has_operating_theatre": "Operating room or theatre available",
    "general_surgery": "General surgical procedures performed",
    "cesarean_capable": "Can perform cesarean sections",
    "anesthesia_available": "Anesthesia services available",
    
    # Imaging & Diagnostics
    "has_xray": "X-ray imaging available",
    "has_ultrasound": "Ultrasound imaging available",
    "has_ct_scan": "CT scanner available",
    "has_mri": "MRI scanner available",
    "has_ecg": "ECG/EKG capability",
    "has_endoscopy": "Endoscopy procedures available",
    "has_laboratory": "On-site laboratory services",
    
    # Maternal & Child
    "maternity_services": "Antenatal, postnatal, or delivery care",
    "nicu_available": "Neonatal Intensive Care Unit",
    "pediatric_ward": "Dedicated pediatric inpatient ward",
    "family_planning": "Family planning and contraception services",
    
    # Specialty Units
    "dialysis_capable": "Hemodialysis or dialysis services",
    "blood_bank": "Blood bank or transfusion services",
    "pharmacy_onsite": "On-site pharmacy or dispensary",
    "dental_services": "Dental care services",
    "eye_care": "Ophthalmology or eye care services",
    "mental_health": "Psychiatry or mental health services",
    "physiotherapy": "Physical therapy or rehabilitation",
    
    # Infrastructure
    "ambulance_service": "Ambulance or patient transport service",
    "inpatient_beds": "Has inpatient bed capacity",
    "outpatient_services": "Provides outpatient care",
    "nhis_accredited": "NHIS insurance accredited",
    
    # Specialized Capabilities
    "ivf_fertility": "IVF or fertility services",
    "cancer_screening": "Cancer screening services",
    "cancer_treatment": "Oncology or cancer treatment",
    "hiv_aids_services": "HIV/AIDS testing and treatment",
    
    # Medical Specialties
    "cardiology_services": "Cardiology or heart care services",
    "echocardiography": "Echocardiography (heart ultrasound) available",
    "nephrology_services": "Nephrology or kidney care services",
    "neurology_services": "Neurology or brain/nerve care services",
    "dermatology_services": "Dermatology or skin care services",
    "ent_services": "Ear, Nose, and Throat (ENT/otolaryngology) services",
    "orthopedic_services": "Orthopedic or bone/joint care services",
    "radiology_services": "Radiology or medical imaging department",
    "pulmonology_services": "Pulmonology or lung/respiratory care services",
    "gastroenterology_services": "Gastroenterology or digestive system services",
    
    # Herbal/Traditional (common in Ghana dataset)
    "herbal_traditional": "Traditional or herbal medicine services",
}


# =============================================================================
# LLM PROMPT TEMPLATE FOR FACT NORMALIZATION
# =============================================================================

NORMALIZATION_SYSTEM_PROMPT = """You are a healthcare data normalization assistant. Your task is to map unstructured facility facts to a controlled vocabulary of capability codes.

RULES:
1. If the fact clearly matches an existing code, use that code. Try to match with all applicable codes.
2. If the fact describes a novel capability not in the vocabulary, propose a new code
3. New codes should follow the naming pattern: lowercase_with_underscores
4. Some facts are just location/contact info - mark these as "not_a_capability"

EXISTING CAPABILITY CODES:
{capability_codes}

Respond with valid JSON only."""

NORMALIZATION_USER_PROMPT = """Map these facts to capability codes. For each fact, provide:
- "fact_text": the original fact
- "mapped_codes": array of existing codes that match (can be multiple), empty array if none
- "proposed_codes": array of new codes if novel capabilities, empty array if none
- "proposed_descriptions": array of descriptions for proposed codes (parallel to proposed_codes), empty array if none
- "confidence": 0.0-1.0 confidence score
- "is_capability": false if this is just location/contact/metadata info

FACTS TO NORMALIZE:
{facts_json}

Respond with a JSON array of objects, one per fact."""


class NormalizedFact(TypedDict):
    """Structure for a normalized fact from LLM."""
    fact_text: str
    mapped_codes: list[str]  # Array of existing codes
    proposed_codes: list[str]  # Array of proposed new codes
    proposed_descriptions: list[str]  # Parallel array of descriptions
    confidence: float
    is_capability: bool


def get_capability_codes_for_prompt() -> str:
    """Format capability codes for inclusion in LLM prompt."""
    lines = []
    for code, description in sorted(SEED_CAPABILITIES.items()):
        lines.append(f"- {code}: {description}")
    return "\n".join(lines)


def build_normalization_prompt(facts: list[str]) -> tuple[str, str]:
    """
    Build system and user prompts for fact normalization.
    
    Returns:
        Tuple of (system_prompt, user_prompt)
    """
    system = NORMALIZATION_SYSTEM_PROMPT.format(
        capability_codes=get_capability_codes_for_prompt()
    )
    user = NORMALIZATION_USER_PROMPT.format(
        facts_json=json.dumps(facts, indent=2)
    )
    return system, user


# =============================================================================
# VOCABULARY MANAGEMENT
# =============================================================================

class CapabilityVocabulary:
    """
    Manages the capability vocabulary, allowing LLM-proposed additions.
    """
    
    def __init__(self):
        self.codes: dict[str, str] = dict(SEED_CAPABILITIES)
        self.proposed_codes: dict[str, dict] = {}  # code -> {description, count, examples}
    
    def add_proposed_code(
        self, 
        code: str, 
        description: str, 
        example_fact: str,
        auto_accept_threshold: int = 3
    ) -> bool:
        """
        Track a proposed new code. Auto-accepts if seen enough times.
        
        Returns True if code was accepted into main vocabulary.
        """
        if code in self.codes:
            return False  # Already exists
            
        if code not in self.proposed_codes:
            self.proposed_codes[code] = {
                "description": description,
                "count": 0,
                "examples": []
            }
        
        self.proposed_codes[code]["count"] += 1
        if len(self.proposed_codes[code]["examples"]) < 5:
            self.proposed_codes[code]["examples"].append(example_fact)
        
        # Auto-accept if seen enough times
        if self.proposed_codes[code]["count"] >= auto_accept_threshold:
            self.codes[code] = description
            del self.proposed_codes[code]
            return True
        
        return False
    
    def get_all_codes(self) -> dict[str, str]:
        """Get current vocabulary (seed + accepted proposals)."""
        return dict(self.codes)
    
    def get_pending_proposals(self) -> dict[str, dict]:
        """Get proposed codes not yet accepted."""
        return dict(self.proposed_codes)
    
    def export_vocabulary(self) -> dict:
        """Export full state for persistence."""
        return {
            "accepted_codes": self.codes,
            "pending_proposals": self.proposed_codes
        }
    
    def import_vocabulary(self, data: dict):
        """Import vocabulary state from persistence."""
        self.codes = data.get("accepted_codes", dict(SEED_CAPABILITIES))
        self.proposed_codes = data.get("pending_proposals", {})


if __name__ == "__main__":
    # Quick test
    print(f"Seed vocabulary has {len(SEED_CAPABILITIES)} codes")
    print("\nSample prompt:")
    sys_prompt, user_prompt = build_normalization_prompt([
        "Has 24-hour emergency department",
        "Located in Accra, Ghana",
        "Performs dialysis treatment 3 times weekly"
    ])
    print(user_prompt[:500])
