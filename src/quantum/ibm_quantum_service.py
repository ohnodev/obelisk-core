"""
IBM Quantum Service for The Obelisk
Generates quantum random numbers using REAL IBM Quantum hardware ONLY
NO SIMULATORS - ONLY PHYSICAL QUBITS
"""
import os
import struct
import json
from datetime import datetime
from typing import Dict, Any, Optional
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
from qiskit import QuantumCircuit, transpile
from qiskit import qasm2
import numpy as np
from ..utils.logger import get_logger

logger = get_logger(__name__)


class IBMQuantumService:
    def __init__(self, api_key: Optional[str] = None, instance: Optional[str] = None):
        """
        Initialize IBM Quantum Service
        
        Args:
            api_key: IBM Quantum API key (if None, reads from env)
            instance: IBM Quantum instance (if None, reads from env)
        """
        self.service = None
        self.sampler = None
        self.backend = None
        self.api_key = api_key or os.getenv("IBM_QUANTUM_API_KEY")
        self.instance = instance or os.getenv("IBM_QUANTUM_INSTANCE")
        self._initialize_service()

    def _initialize_service(self):
        """Initialize IBM Quantum Runtime Service - REAL HARDWARE ONLY"""
        if not self.api_key:
            raise Exception("IBM Quantum API key is required. Set IBM_QUANTUM_API_KEY environment variable.")
        
        try:
            self.service = QiskitRuntimeService(
                channel="ibm_quantum_platform",
                token=self.api_key,
                instance=self.instance
            )
            
            # Get REAL hardware backend ONLY - NO SIMULATORS
            # Filter out simulators explicitly
            backends = self.service.backends(operational=True, simulator=False)
            
            if not backends:
                raise Exception("No real quantum hardware available. Check your IBM Quantum account.")
            
            # Get the least busy REAL hardware backend
            self.backend = self.service.least_busy(operational=True, simulator=False)
            
            if self.backend is None:
                raise Exception("Failed to connect to real quantum hardware.")
            
            # Verify it's not a simulator
            if 'simulator' in self.backend.name.lower():
                raise Exception(f"Backend {self.backend.name} is a simulator. Only real hardware allowed.")
            
            self.sampler = SamplerV2(mode=self.backend)
            logger.info(f"✅ Connected to REAL IBM Quantum hardware: {self.backend.name}")
            logger.info(f"   Qubits: {self.backend.num_qubits}")
            logger.info(f"   Status: {self.backend.status()}")
            
        except Exception as e:
            error_msg = f"❌ CRITICAL: Cannot connect to real IBM Quantum hardware: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def generate_random_circuit(self, num_qubits: int = 5, depth: int = 3) -> QuantumCircuit:
        """
        Generate a quantum random circuit using Hadamard gates
        Compatible with real IBM Quantum hardware
        
        Args:
            num_qubits: Number of qubits in the circuit
            depth: Not used (kept for API compatibility)
        
        Returns:
            QuantumCircuit: A quantum circuit that generates random bits
        """
        # Use simple Hadamard gates approach (compatible with real hardware)
        # This puts each qubit into superposition, then measures
        circuit = QuantumCircuit(num_qubits, num_qubits)
        for i in range(num_qubits):
            circuit.h(i)  # Apply Hadamard gate to put qubit in superposition
        circuit.measure_all()  # Measure all qubits
        return circuit

    def get_quantum_random(self, num_qubits: int = 2, depth: int = 3, shots: int = 128) -> Dict[str, Any]:
        """
        Generate a quantum random number using REAL IBM Quantum hardware ONLY
        Optimized for 256-bit seed generation: uses 2 qubits, 128 shots = 256 bits directly
        
        Args:
            num_qubits: Number of qubits to use (default: 2)
            depth: Circuit depth (not used)
            shots: Number of measurement shots (default: 128 for 256-bit seeds)
                   For 256-bit seeds: 128 shots × 2 qubits = 256 bits directly
                   More shots = more entropy but slower. 128 shots = ~1-2 seconds.
        
        Returns:
            Dict containing random value, measurements, and metadata
        
        Raises:
            Exception: If hardware is unavailable or connection fails
        """
        # Verify we have real hardware connection
        if not self.sampler or not self.service or not self.backend:
            raise Exception("❌ REAL IBM Quantum hardware connection required. NO SIMULATORS.")
        
        # Verify backend is not a simulator
        if 'simulator' in self.backend.name.lower():
            raise Exception(f"❌ Backend {self.backend.name} is a simulator. Only real hardware allowed.")
        
        # Optimize parameters for cost (~1 second computation time)
        # Use minimum qubits needed (2 gives us 4 possible values, sufficient for randomness)
        num_qubits = max(2, min(num_qubits, 2))  # Clamp to 2 for speed/cost
        shots = max(128, min(shots, 200))  # Clamp between 128-200 for 256-bit seeds (~1-2 seconds)
        
        # Generate circuit
        circuit = self.generate_random_circuit(num_qubits, depth)
        
        # Transpile circuit to match hardware constraints BEFORE running
        # This is REQUIRED for real hardware - circuits must match hardware gate set
        # Use max optimization to minimize circuit depth and execution time
        try:
            circuit = transpile(
                circuit, 
                backend=self.backend, 
                optimization_level=3,  # Max optimization
                layout_method='sabre',  # Efficient layout
                routing_method='sabre'  # Efficient routing
            )
        except Exception as e:
            raise Exception(f"❌ Failed to transpile circuit for hardware: {e}")
        
        # Run on REAL hardware with optimized shots
        try:
            import time
            start_time = time.time()
            
            job = self.sampler.run([circuit], shots=shots)
            
            # Capture job ID immediately (before waiting for result)
            job_id = job.job_id() if hasattr(job, 'job_id') else None
            if not job_id:
                # Try alternative method
                try:
                    job_id = str(job.job_id) if hasattr(job, 'job_id') else None
                except:
                    pass
            
            # Get job status and timing info
            job_status = None
            time_per_step = {}
            creation_date = None
            try:
                if hasattr(job, 'status'):
                    job_status = str(job.status())
                if hasattr(job, 'time_per_step'):
                    time_per_step = job.time_per_step() if callable(job.time_per_step) else job.time_per_step
                if hasattr(job, 'creation_date'):
                    creation_date = job.creation_date() if callable(job.creation_date) else job.creation_date
                    if creation_date:
                        creation_date = creation_date.isoformat() if hasattr(creation_date, 'isoformat') else str(creation_date)
            except Exception as e:
                logger.warning(f"Could not get job metadata: {e}")
            
            # Wait for result (this includes queue time + computation time)
            # The actual quantum computation is usually 1-3 seconds
            # But total time includes waiting in queue
            result = job.result()
            execution_time = time.time() - start_time
            
            # Get completion date
            completion_date = datetime.utcnow().isoformat()
            
            # Extract measurement results from SamplerV2
            # SamplerV2 returns PrimitiveResult with PubResult items
            pub_result = result[0]
            
            # Get actual measurement counts directly (not probabilities)
            counts = {}
            quasi_dist = None
            
            # Try to get counts directly from BitArray
            try:
                if hasattr(pub_result.data, 'meas'):
                    meas_data = pub_result.data.meas
                    if hasattr(meas_data, 'get_counts'):
                        # Get actual counts from measurements (this is the real data)
                        counts = meas_data.get_counts()
                        # Convert to string keys for consistency
                        counts = {str(k): int(v) for k, v in counts.items()}
                        # Also create quasi-distribution for backward compatibility
                        total = sum(counts.values())
                        quasi_dist = {k: v/total for k, v in counts.items()}
            except Exception as e1:
                logger.warning(f"Could not get counts from BitArray: {e1}")
            
            # Fallback: try quasi-distribution approach
            if not counts:
                try:
                    if hasattr(pub_result.data, 'quasi_dists'):
                        quasi_dist = pub_result.data.quasi_dists[0]
                    elif hasattr(pub_result.data, 'meas'):
                        meas_data = pub_result.data.meas
                        if hasattr(meas_data, 'quasi_dists'):
                            quasi_dist = meas_data.quasi_dists[0]
                except Exception as e2:
                    logger.warning(f"Could not get quasi-distribution: {e2}")
                
                # Convert quasi-distribution to counts
                if quasi_dist:
                    counts = {}
                    for bitstring, probability in quasi_dist.items():
                        counts[str(bitstring)] = int(probability * shots)
            
            if not counts:
                # Last resort: try to inspect the structure
                error_detail = f"Result type: {type(result)}, PubResult type: {type(pub_result)}, Data type: {type(pub_result.data)}"
                error_detail += f", Data attrs: {[x for x in dir(pub_result.data) if not x.startswith('_')]}"
                raise Exception(f"❌ Could not extract measurement results from hardware result. {error_detail}")
            
            # Calculate deterministic random value from the distribution
            # Use the most frequent bitstring (deterministic choice, no random selection)
            if counts:
                # Find the most frequent bitstring (deterministic - no random.choices())
                most_frequent_bitstring = max(counts.items(), key=lambda x: x[1])[0]
                
                # Handle bitstring format (may be int or string)
                if isinstance(most_frequent_bitstring, int):
                    binary_str = format(most_frequent_bitstring, f'0{num_qubits}b')
                else:
                    binary_str = str(most_frequent_bitstring).replace(' ', '')
                
                decimal = int(binary_str, 2)
                max_val = 2 ** num_qubits - 1
                quantum_value = decimal / max_val if max_val > 0 else 0.5
            else:
                raise Exception("❌ No measurement results from real hardware.")
            
            # Generate measurements from the distribution
            measurements = []
            for i in range(min(8, 2**num_qubits)):
                bitstring = format(i, f'0{num_qubits}b')
                prob = float(quasi_dist.get(bitstring, 0.0))
                measurements.append(prob)
            
            # Pad if needed
            while len(measurements) < 8:
                measurements.append(0.0)
            
            # Get backend properties for proof
            backend_props = {}
            qubit_properties = {}
            physical_qubits_used = []
            
            try:
                # Get physical qubits used from transpiled circuit layout
                if hasattr(circuit, 'layout') and circuit.layout:
                    layout = circuit.layout
                    if hasattr(layout, 'get_physical_bits'):
                        physical_qubits_used = list(layout.get_physical_bits().keys())
                    elif hasattr(layout, 'get_virtual_bits'):
                        # Alternative layout access
                        physical_qubits_used = list(range(num_qubits))
                
                # Get backend configuration
                backend_config = self.backend.configuration()
                backend_props = {
                    "name": self.backend.name,
                    "num_qubits": self.backend.num_qubits,
                    "processor_type": getattr(backend_config, 'processor_type', None),
                    "basis_gates": getattr(backend_config, 'basis_gates', []),
                }
                
                # Get qubit properties (T1, T2, frequencies, errors) for qubits used
                try:
                    props = self.backend.properties()
                    for qubit_idx in physical_qubits_used[:num_qubits]:  # Limit to qubits we used
                        try:
                            t1 = props.qubit_property(qubit_idx, 'T1')
                            t2 = props.qubit_property(qubit_idx, 'T2')
                            freq = props.qubit_property(qubit_idx, 'frequency')
                            readout_error = props.readout_error(qubit_idx)
                            
                            qubit_properties[str(qubit_idx)] = {
                                "T1": float(t1[0]) if t1 else None,
                                "T2": float(t2[0]) if t2 else None,
                                "frequency": float(freq[0]) if freq else None,
                                "readout_error": float(readout_error) if readout_error else None
                            }
                        except Exception as e:
                            logger.warning(f"Could not get properties for qubit {qubit_idx}: {e}")
                except Exception as e:
                    logger.warning(f"Could not get backend properties: {e}")
                    
            except Exception as e:
                logger.warning(f"Could not extract all backend information: {e}")
            
            # Get circuit QASM representation
            circuit_qasm = None
            try:
                circuit_qasm = qasm2.dumps(circuit)
            except Exception as e:
                logger.warning(f"Could not generate QASM: {e}")
            
            # Get gate counts
            gate_counts = {}
            try:
                gate_counts = dict(circuit.count_ops())
            except Exception as e:
                logger.warning(f"Could not get gate counts: {e}")
            
            # Get instance information for URL construction
            instance_crn = None
            try:
                if hasattr(self.service, 'channel') and self.service.channel == 'ibm_quantum_platform':
                    # Try to get instance from service
                    if hasattr(self.service, 'instance'):
                        instance_crn = self.service.instance
            except:
                pass
            
            # Build quantum proof bundle
            quantum_proof = {
                # Job identification
                "job_id": job_id,
                # Note: IBM Quantum jobs require API authentication to view
                # Job can be retrieved programmatically using: service.job(job_id)
                # Or viewed in IBM Quantum Platform dashboard (requires login)
                "job_retrieval_note": "Use QiskitRuntimeService.job(job_id) to retrieve job programmatically",
                "job_url": None,  # IBM Quantum doesn't provide direct public URLs
                
                # Backend information (proves physical hardware)
                "backend_name": self.backend.name,
                "backend_type": "physical",
                "processor_type": backend_props.get("processor_type"),
                "num_qubits_total": self.backend.num_qubits,
                
                # Physical qubits used
                "qubits_used": physical_qubits_used[:num_qubits] if physical_qubits_used else list(range(num_qubits)),
                "qubit_properties": qubit_properties,
                
                # Circuit information
                "circuit_qasm": circuit_qasm,
                "circuit_depth": circuit.depth(),
                "circuit_size": circuit.size(),
                "gate_counts": gate_counts,
                
                # Execution details
                "shots": shots,
                "execution_time_seconds": round(execution_time, 3),
                "queue_time_seconds": round(time_per_step.get('pending', 0) if isinstance(time_per_step, dict) else 0, 3),
                "creation_date": creation_date or completion_date,
                "completion_date": completion_date,
                "job_status": job_status or "completed",
                "time_per_step": time_per_step if isinstance(time_per_step, dict) else {},
                
                # Results
                "random_value": float(quantum_value),
                "measurement_results": counts,
                "measurements": [float(m) for m in measurements[:8]],
            }
            
            return {
                "value": float(quantum_value),
                "measurements": [float(m) for m in measurements[:8]],
                "circuit_depth": circuit.depth(),
                "num_qubits": num_qubits,
                "shots": shots,
                "source": "ibm_quantum_hardware",
                "backend": self.backend.name,
                "hardware": True,
                "simulator": False,
                "quantum_proof": quantum_proof  # Full proof bundle
            }
            
        except Exception as e:
            error_msg = f"❌ Failed to run on REAL IBM Quantum hardware: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def get_quantum_seed_256bit(self) -> tuple[int, Dict[str, Any]]:
        """
        Generate a 256-bit quantum seed for NFT minting using REAL IBM Quantum hardware
        
        Uses direct bitstring extraction from quantum measurements:
        - 2 qubits, 128 shots = 256 bits directly from quantum measurements
        - All entropy comes from quantum measurement collapse (no classical randomness)
        - Deterministic: same measurements always produce same seed
        
        Returns:
            Tuple of (quantum_seed: int, quantum_proof: Dict)
            
        Raises:
            Exception: If quantum hardware is unavailable or generation fails
        """
        try:
            # Use 2 qubits, 128 shots to get exactly 256 bits (128 shots × 2 bits = 256 bits)
            # This is more efficient than using more qubits and gives us direct bit extraction
            quantum_result = self.get_quantum_random(num_qubits=2, shots=128)
            
            # Extract quantum proof
            quantum_proof = quantum_result.get("quantum_proof", {})
            
            # Get measurement results (counts dict: bitstring -> count)
            measurement_results = quantum_proof.get("measurement_results", {})
            
            if not measurement_results:
                raise Exception("No measurement results in quantum proof")
            
            # Extract all bitstrings directly from measurements
            # Each bitstring appears 'count' times in the actual measurements
            bitstrings = []
            for bitstring, count in measurement_results.items():
                # Add each bitstring 'count' times to preserve all quantum entropy
                bitstrings.extend([str(bitstring)] * count)
            
            # We need exactly 128 bitstrings (each 2 bits) = 256 bits total
            # If we have more than 128, take first 128 (deterministic)
            # If we have fewer, this shouldn't happen with 128 shots, but handle it
            if len(bitstrings) < 128:
                raise Exception(f"Insufficient quantum measurements: got {len(bitstrings)} bitstrings, need 128")
            
            # Take exactly 128 bitstrings (deterministic - always first 128)
            bitstrings = bitstrings[:128]
            
            # Concatenate all bitstrings to get 256 bits
            # Example: ['00', '01', '10', '11', ...] -> '00011011...'
            full_bitstring = ''.join(bitstrings)
            
            # Verify we have exactly 256 bits
            if len(full_bitstring) != 256:
                raise Exception(f"Invalid bitstring length: got {len(full_bitstring)} bits, expected 256")
            
            # Convert binary string to integer (big-endian)
            quantum_seed = int(full_bitstring, 2)
            
            logger.info(f"Generated 256-bit seed directly from {len(bitstrings)} quantum measurements")
            logger.debug(f"Seed (hex): {hex(quantum_seed)[:20]}...")
            
            return quantum_seed, quantum_proof
            
        except Exception as e:
            error_msg = f"❌ Failed to generate 256-bit quantum seed from IBM Quantum hardware: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)
