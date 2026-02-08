"""
This file is adapted from:
https://github.com/CityScope/UrbanAccessAnalyzer/blob/main/UrbanAccessAnalyzer/quality.py

Originally developed by Miguel Ureña Pliego
for MIT Media Lab – City Science Group.

License: GNU General Public License v3.0 (GPL-3.0)

Modifications:
- Minor refactoring
- Integrated into the Health-Connect project
"""

import numpy as np
from typing import (
    List,
    TypeVar,
    Union,
)

# Type variables
T = TypeVar("T")  # Generic input type (interval, route_type, etc.)


def build_adaptive_grids(
    func: callable,
    variables: List[Union[List[float], tuple, np.ndarray]],
    delta: float = 0.1,
    max_iters: int = 30,
) -> List[np.ndarray]:
    """
    Build adaptive grids for multiple variables to guarantee that stepping along
    any continuous variable changes the function by at most `delta`.

    Each variable can be:
        - Continuous: [min, max] or (min, max)
        - Pre-discrete: list or np.ndarray of values

    Args:
        func: Callable supporting broadcasting, e.g., func(var1, var2, ...)
        variables: List of variable specifications
        delta: Max allowed change between adjacent points in any continuous variable
        max_iters: Max number of refinement iterations

    Returns:
        List of np.ndarray grids for each variable
    """
    n_vars = len(variables)

    # Initialize grids and detect discrete variables
    grids = []
    is_discrete = []
    for var in variables:
        if (
            isinstance(var, (list, tuple))
            and len(var) == 2
            and all(isinstance(x, (int, float)) for x in var)
        ):
            grids.append(np.array([var[0], var[1]], dtype=float))  # continuous
            is_discrete.append(False)
        else:
            arr = np.array(var)
            grids.append(arr)
            is_discrete.append(True)

    for _ in range(max_iters):
        changed_any = False

        for i, (grid, discrete) in enumerate(zip(grids, is_discrete)):
            if discrete:
                continue  # skip refinement for pre-discrete variables

            # --- Broadcast all variables safely ---
            broadcast_vars = []
            for j, g in enumerate(grids):
                shape = [1] * n_vars
                shape[j] = len(g)
                broadcast_vars.append(np.reshape(g, shape))

            # Evaluate function on full grid
            q = func(*broadcast_vars)

            # Compute differences along the axis of current variable
            dq = np.abs(np.diff(q, axis=i))

            # Collapse all other axes to find the worst-case delta
            worst_dq = dq.max(axis=tuple(k for k in range(n_vars) if k != i))

            # Identify intervals that exceed delta
            bad = worst_dq > delta
            if not np.any(bad):
                continue

            # Insert midpoints where needed
            mids = 0.5 * (grid[:-1][bad] + grid[1:][bad])
            new_grid = np.sort(np.unique(np.concatenate([grid, mids])))
            grids[i] = new_grid
            changed_any = True

        if not changed_any:
            break

    return grids
